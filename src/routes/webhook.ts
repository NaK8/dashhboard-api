import { Hono } from "hono";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../db";
import { orders, orderItems, testCatalog, webhookLogs } from "../db/schema";
import { webhookPayloadSchema } from "../lib/types";
import {
  extractPatientFields,
  normalizeFormSlug,
  normalizeTestName,
  generateOrderNumber,
  success,
  error,
} from "../lib/utils";

const webhook = new Hono();

// ─── POST /webhook/metform ───────────────────────────────
// Receives form submissions from WordPress Metform.
// Creates an order + order_items in a single transaction.

webhook.post("/metform", async (c) => {
  let rawPayload: Record<string, unknown>;

  try {
    const contentType = c.req.header("content-type") || "";
    console.log(`📨 Webhook received | Content-Type: ${contentType}`);

    if (contentType.includes("application/json")) {
      rawPayload = await c.req.json();
    } else {
      const formData = await c.req.parseBody();
      rawPayload = formData as Record<string, unknown>;
    }

    // Hono's parseBody can return objects with a null prototype (Object.create(null)).
    // Drizzle ORM crashes when checking these objects. Normalizing to a standard object:
    rawPayload = rawPayload ? JSON.parse(JSON.stringify(rawPayload)) : {};

    // WordPress Metform sends `entries` as a JSON string when using
    // application/x-www-form-urlencoded. Parse it back into an object.
    if (typeof rawPayload.entries === "string") {
      try {
        rawPayload.entries = JSON.parse(rawPayload.entries);
      } catch {
        console.warn("⚠️  Could not parse entries string, using as-is");
      }
    }

    console.log(`📦 Payload keys: ${Object.keys(rawPayload).join(", ")}`);
  } catch (parseErr) {
    console.error("❌ Webhook payload parsing failed:", parseErr);
    return c.json(error("Invalid payload"), 400);
  }

  // ── Log the raw webhook ─────────────────────────────────
  const [logEntry] = await db
    .insert(webhookLogs)
    .values({ payload: rawPayload, status: "received" })
    .returning({ id: webhookLogs.id });

  try {
    // ── Verify webhook secret ─────────────────────────────
    const secret =
      c.req.header("x-webhook-secret") ||
      c.req.query("secret") ||
      (rawPayload["webhook_secret"] as string) ||
      "";

    const expectedSecret = process.env.WEBHOOK_SECRET || "";

    if (expectedSecret && secret !== expectedSecret) {
      await db
        .update(webhookLogs)
        .set({ status: "failed", errorMessage: "Invalid webhook secret" })
        .where(eq(webhookLogs.id, logEntry.id));
      return c.json(error("Unauthorized"), 401);
    }

    // ── Parse payload ─────────────────────────────────────
    const parsed = webhookPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      console.error("❌ Zod validation failed:", parsed.error.message);
      console.error("   Raw payload:", JSON.stringify(rawPayload).slice(0, 500));
      await db
        .update(webhookLogs)
        .set({ status: "failed", errorMessage: parsed.error.message })
        .where(eq(webhookLogs.id, logEntry.id));
      return c.json(error("Invalid form data"), 400);
    }
    console.log(`✅ Zod validation passed | form_id: ${parsed.data.form_id} | entry_id: ${parsed.data.entry_id}`);

    const data = parsed.data;
    const { entries, form_id, form_name, entry_id, file_uploads, webhook_secret, ...extraFields } = data;

    // ── Unwrap entries (Metform wraps all form fields inside entries) ──
    const formFields: Record<string, unknown> = entries
      ? { ...entries, ...extraFields }
      : { ...extraFields };

    // ── Extract structured fields ─────────────────────────
    const patient = extractPatientFields(formFields, file_uploads);

    const entryId = entry_id ? String(entry_id) : `wp-${Date.now()}`;
    const formSlug = normalizeFormSlug(form_id || form_name);
    const orderNumber = generateOrderNumber();

    // ── Resolve tests from catalog ────────────────────────
    // Each test carries a categoryHint from its form field, which lets us
    // search within the right category before falling back to global matching.
    const resolvedTests: Array<{
      testId: number;
      testName: string;
      category: string;
      price: string;
    }> = [];

    for (const { name: rawTestName, categoryHint } of patient.tests) {
      // 1. Parse "Name-$Price" format (e.g., "UTI-Urinary-Tract-Infection-$140")
      const priceMatch = rawTestName.match(/^(.*)-\$(\d+)$/);
      const namePart = priceMatch ? priceMatch[1].replace(/-/g, " ") : rawTestName.replace(/-/g, " ");
      const pricePart = priceMatch ? priceMatch[2] : null;

      // 2. Normalize for matching
      const normalizedName = normalizeTestName(namePart);

      // 3. Exact searchName within known category (most reliable)
      let catalogTest = await db.query.testCatalog.findFirst({
        where: and(
          eq(testCatalog.searchName, normalizedName),
          eq(testCatalog.category, categoryHint),
        ),
      });

      // 4. Exact searchName globally (category may differ from hint)
      if (!catalogTest) {
        catalogTest = await db.query.testCatalog.findFirst({
          where: eq(testCatalog.searchName, normalizedName),
        });
      }

      // 5. Category + Price combo (catches ambiguous names with same price)
      if (!catalogTest && pricePart) {
        catalogTest = await db.query.testCatalog.findFirst({
          where: and(
            eq(testCatalog.category, categoryHint),
            sql`${testCatalog.price}::numeric = ${pricePart}::numeric`
          ),
        });
      }

      // 6. Fuzzy searchName within category
      if (!catalogTest) {
        catalogTest = await db.query.testCatalog.findFirst({
          where: and(
            eq(testCatalog.category, categoryHint),
            sql`${testCatalog.searchName} LIKE ${"%" + normalizedName + "%"}`,
          ),
        });
      }

      // 7. Global fuzzy fallback
      if (!catalogTest) {
        catalogTest = await db.query.testCatalog.findFirst({
          where: sql`${testCatalog.searchName} LIKE ${"%" + normalizedName + "%"}`,
        });
      }

      if (catalogTest) {
        resolvedTests.push({
          testId: catalogTest.id,
          testName: catalogTest.testName,
          category: catalogTest.category,
          price: catalogTest.price,
        });
      } else {
        console.warn(`⚠️  Test not found: "${rawTestName}" (normalized: "${normalizedName}", hint: "${categoryHint}")`);
      }
    }

    // ── Calculate total with fees ─────────────────────────
    // Walk-in forms → collection fee only (from mf-collection-fees)
    // In-house forms → travel fee only (from mf-travel-fees)
    // There is NO collection fee on in-house, NO travel fee on walk-in.
    const testTotal = resolvedTests.reduce((sum, t) => sum + parseFloat(t.price), 0);

    const isHomeCollection = patient.orderType === "home_collection";
    const collectionFee = isHomeCollection ? 0 : (patient.collectionFee ?? 0);
    const travelFeeAmount = isHomeCollection ? (patient.travelFeeData?.amount ?? 0) : 0;
    const isTravelFeeOutOfRange = isHomeCollection && (patient.travelFeeData?.outOfRange ?? false);

    const totalAmount = (testTotal + collectionFee + travelFeeAmount).toFixed(2);

    // Flag out-of-range travel fees so staff can handle manually
    const outOfRangeNote = isTravelFeeOutOfRange
      ? "⚠️ TRAVEL FEE OUT OF RANGE — This patient's address is outside the standard service area. Travel fee requires manual review."
      : null;

    const { orderType, location, paymentMethod } = patient;

    // ── Insert order + items in a single transaction ──────
    const order = await db.transaction(async (tx) => {
      const [newOrder] = await tx
        .insert(orders)
        .values({
          wpEntryId: entryId,
          orderNumber,
          patientName: patient.patientName || "Unknown Patient",
          patientDob: patient.patientDob || null,
          patientPhone: patient.patientPhone || null,
          patientSecondaryPhone: patient.patientSecondaryPhone,
          patientAddress: patient.patientAddress || null,
          patientEmail: patient.patientEmail || null,
          patientCity: patient.patientCity || null,
          patientState: patient.patientState || null,
          patientZipCode: patient.patientZipCode || null,
          referralSource: patient.referralSource || null,
          allergyInfo: patient.allergyInfo || null,
          consentData: patient.consentData,
          physicianName: patient.physicianName || null,
          clinicAddress: patient.clinicAddress || null,
          scheduleDate: patient.scheduleDate || null,
          scheduleTime: patient.scheduleTime || null,
          dateOfOrder: patient.dateOfOrder || new Date().toISOString().slice(0, 10),
          formSlug,
          formName: form_name ? String(form_name) : null,
          location,
          orderType,
          paymentMethod,
          paymentStatus: "pending",
          sampleCollectionFee: collectionFee.toFixed(2),
          travelFee: travelFeeAmount.toFixed(2),
          totalAmount,
          status: "pending",
          notes: outOfRangeNote,
          signatureBase64: patient.signatureBase64,
          drivingLicenseUrl: patient.drivingLicenseUrl,
          rawFormData: rawPayload,
        })
        .onConflictDoUpdate({
          target: orders.wpEntryId,
          set: {
            patientName: patient.patientName || "Unknown Patient",
            patientPhone: patient.patientPhone || null,
            patientEmail: patient.patientEmail || null,
            patientCity: patient.patientCity || null,
            patientState: patient.patientState || null,
            patientZipCode: patient.patientZipCode || null,
            referralSource: patient.referralSource || null,
            allergyInfo: patient.allergyInfo || null,
            consentData: patient.consentData,
            location,
            orderType,
            paymentMethod,
            sampleCollectionFee: collectionFee.toFixed(2),
            travelFee: travelFeeAmount.toFixed(2),
            totalAmount,
            notes: outOfRangeNote,
            signatureBase64: patient.signatureBase64,
            drivingLicenseUrl: patient.drivingLicenseUrl,
            rawFormData: rawPayload,
            updatedAt: new Date(),
          },
        })
        .returning();

      if (resolvedTests.length > 0) {
        await tx.insert(orderItems).values(
          resolvedTests.map((test) => ({
            orderId: newOrder.id,
            testId: test.testId,
            testName: test.testName,
            category: test.category,
            priceAtOrder: test.price,
          }))
        );
      }

      return newOrder;
    });

    // ── Mark webhook as processed ─────────────────────────
    await db
      .update(webhookLogs)
      .set({ status: "processed", processedAt: new Date() })
      .where(eq(webhookLogs.id, logEntry.id));

    console.log(
      `✅ Order created: ${orderNumber} | ${patient.patientName} | ${resolvedTests.length} tests | $${totalAmount}`
    );

    return c.json(
      success({
        id: order.id,
        orderNumber: order.orderNumber,
        testsMatched: resolvedTests.length,
        testsSubmitted: patient.tests.length,
        totalAmount,
        message: "Order received successfully",
      }),
      201
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";

    await db
      .update(webhookLogs)
      .set({ status: "failed", errorMessage: errMsg })
      .where(eq(webhookLogs.id, logEntry.id));

    console.error("❌ Webhook processing failed:", errMsg);
    return c.json(error("Internal server error"), 500);
  }
});

// ─── GET /webhook/health ─────────────────────────────────

webhook.get("/health", (c) => {
  return c.json(
    success({ status: "ok", timestamp: new Date().toISOString() })
  );
});

export default webhook;
