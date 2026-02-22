import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { testCatalog } from "../db/schema";
import { createTestSchema, updateTestSchema } from "../lib/types";
import { success, error, normalizeTestName } from "../lib/utils";
import { authMiddleware, adminOnly } from "../middleware/auth";

const testsRoute = new Hono();

// ─── GET /tests — list all tests (public for dashboard) ──
// Auth required but both admin and staff can see

testsRoute.get("/", authMiddleware, async (c) => {
  const showAll = c.req.query("all") === "true";

  const tests = await db.query.testCatalog.findMany({
    where: showAll ? undefined : eq(testCatalog.isActive, true),
    orderBy: (t, { asc }) => [asc(t.category), asc(t.testName)],
  });

  // Group by category for easy frontend rendering
  const grouped = tests.reduce(
    (acc, test) => {
      if (!acc[test.category]) acc[test.category] = [];
      acc[test.category].push(test);
      return acc;
    },
    {} as Record<string, typeof tests>
  );

  return c.json(
    success({
      tests,
      grouped,
      totalTests: tests.length,
    })
  );
});

// ─── GET /tests/:id — single test ───────────────────────

testsRoute.get("/:id", authMiddleware, async (c) => {
  const id = parseInt(c.req.param("id"));

  if (isNaN(id)) {
    return c.json(error("Invalid test ID"), 400);
  }

  const test = await db.query.testCatalog.findFirst({
    where: eq(testCatalog.id, id),
  });

  if (!test) {
    return c.json(error("Test not found"), 404);
  }

  return c.json(success(test));
});

// ─── POST /tests — add new test (admin only) ────────────

testsRoute.post(
  "/",
  authMiddleware,
  adminOnly,
  zValidator("json", createTestSchema),
  async (c) => {
    const data = c.req.valid("json");

    const [newTest] = await db
      .insert(testCatalog)
      .values({
        ...data,
        searchName: normalizeTestName(data.testName),
      })
      .returning();

    return c.json(success(newTest), 201);
  }
);

// ─── PATCH /tests/:id — update test (admin only) ────────

testsRoute.patch(
  "/:id",
  authMiddleware,
  adminOnly,
  zValidator("json", updateTestSchema),
  async (c) => {
    const id = parseInt(c.req.param("id"));
    const updates = c.req.valid("json");

    if (isNaN(id)) {
      return c.json(error("Invalid test ID"), 400);
    }

    // If testName is being updated, regenerate searchName
    const setFields: Record<string, unknown> = {
      ...updates,
      updatedAt: new Date(),
    };

    if (updates.testName) {
      setFields.searchName = normalizeTestName(updates.testName);
    }

    const [updated] = await db
      .update(testCatalog)
      .set(setFields)
      .where(eq(testCatalog.id, id))
      .returning();

    if (!updated) {
      return c.json(error("Test not found"), 404);
    }

    return c.json(success(updated));
  }
);

// ─── DELETE /tests/:id — deactivate test (admin only) ───

testsRoute.delete("/:id", authMiddleware, adminOnly, async (c) => {
  const id = parseInt(c.req.param("id"));

  if (isNaN(id)) {
    return c.json(error("Invalid test ID"), 400);
  }

  // Soft delete — deactivate, don't remove (preserves order history)
  const [updated] = await db
    .update(testCatalog)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(testCatalog.id, id))
    .returning({ id: testCatalog.id, testName: testCatalog.testName });

  if (!updated) {
    return c.json(error("Test not found"), 404);
  }

  return c.json(success({ message: `${updated.testName} deactivated` }));
});

export default testsRoute;
