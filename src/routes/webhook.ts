import { Hono } from "hono";
import { eq, ilike, and, sql } from "drizzle-orm";
import { db } from "../db";
import { orders, orderItems, testCatalog, webhookLogs } from "../db/schema";
import { webhookPayloadSchema } from "../lib/types";
import {
  extractPatientFields,
  normalizeFormSlug,
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
    if (contentType.includes("application/json")) {
      rawPayload = await c.req.json();
    } else {
      const formData = await c.req.parseBody();
      rawPayload = formData as Record<string, unknown>;
    }
  } catch {
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
      await db
        .update(webhookLogs)
        .set({ status: "failed", errorMessage: parsed.error.message })
        .where(eq(webhookLogs.id, logEntry.id));
      return c.json(error("Invalid form data"), 400);
    }

    const data = parsed.data;
    const { entries, form_id, form_name, entry_id, file_uploads, webhook_secret, ...extraFields } = data;

    // ── Unwrap entries (Metform wraps all form fields inside entries) ──
    const formFields: Record<string, unknown> = entries
      ? { ...entries, ...extraFields }
      : { ...extraFields };

    // ── Extract structured fields ─────────────────────────
    const patient = extractPatientFields(formFields);

    const entryId = entry_id ? String(entry_id) : `wp-${Date.now()}`;
    const formSlug = normalizeFormSlug(form_id || form_name);
    const orderNumber = generateOrderNumber();

    // ── Resolve tests from catalog ────────────────────────
    // Match test names from the form to our catalog.
    // This handles slight name variations with ILIKE.
    const resolvedTests: Array<{
      testId: number;
      testName: string;
      category: string;
      price: string;
    }> = [];

    for (const rawTestName of patient.testNames) {
      // 1. Parse "Name-$Price" format (e.g., "drug-screening-and-confirmation-$140")
      const priceMatch = rawTestName.match(/^(.*)-\$(\d+)$/);
      const namePart = priceMatch ? priceMatch[1].replace(/-/g, " ") : rawTestName;
      const pricePart = priceMatch ? priceMatch[2] : null;

      // 2. Try Exact Match (on namePart)
      let catalogTest = await db.query.testCatalog.findFirst({
        where: eq(testCatalog.testName, namePart),
      });

      // 3. Try Category + Price Match (if we have both)
      if (!catalogTest && pricePart && patient.category) {
        // Normalize category: "drug-testing" -> "drug_testing" to match Enum
        const normalizedCategory = patient.category.replace(/-/g, "_");

        catalogTest = await db.query.testCatalog.findFirst({
          where: and(
            eq(testCatalog.category, normalizedCategory as any),
            // Compare price (cast DB numeric to simple string comparison handling .00)
             sql`${testCatalog.price}::numeric = ${pricePart}::numeric`
          ),
        });
      }

      // 4. Try Fuzzy Match (fallback)
      if (!catalogTest) {
        // Clean up formatting: "drug-screening-and-confirmation" -> "drug screening and confirmation"
        const cleanedName = namePart.replace(/-/g, " ");
        catalogTest = await db.query.testCatalog.findFirst({
          where: ilike(testCatalog.testName, `%${cleanedName}%`),
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
        console.warn(`⚠️  Test not found in catalog: "${rawTestName}" (parsed: ${namePart})`);
      }
    }

    // ── Calculate total ───────────────────────────────────
    const totalAmount = resolvedTests
      .reduce((sum, t) => sum + parseFloat(t.price), 0)
      .toFixed(2);

    // ── Insert order ──────────────────────────────────────
    const [order] = await db
      .insert(orders)
      .values({
        wpEntryId: entryId,
        orderNumber,
        patientName: patient.patientName || "Unknown Patient",
        patientDob: patient.patientDob || null,
        patientPhone: patient.patientPhone || null,
        patientSecondaryPhone: patient.patientSecondaryPhone,
        patientAddress: patient.patientAddress || null,
        physicianName: patient.physicianName || null,
        clinicAddress: patient.clinicAddress || null,
        scheduleDate: patient.scheduleDate || null,
        scheduleTime: patient.scheduleTime || null,
        dateOfOrder: patient.dateOfOrder || new Date().toISOString().slice(0, 10),
        formSlug,
        formName: form_name ? String(form_name) : null,
        totalAmount,
        status: "pending",
        rawFormData: rawPayload,
      })
      .onConflictDoUpdate({
        target: orders.wpEntryId,
        set: {
          patientName: patient.patientName || "Unknown Patient",
          patientPhone: patient.patientPhone || null,
          physicianName: patient.physicianName || null,
          clinicAddress: patient.clinicAddress || null,
          rawFormData: rawPayload,
          updatedAt: new Date(),
        },
      })
      .returning();

    // ── Insert order items ────────────────────────────────
    if (resolvedTests.length > 0) {
      await db.insert(orderItems).values(
        resolvedTests.map((test) => ({
          orderId: order.id,
          testId: test.testId,
          testName: test.testName,
          category: test.category,
          priceAtOrder: test.price,
        }))
      );
    }

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
        testsSubmitted: patient.testNames.length,
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
