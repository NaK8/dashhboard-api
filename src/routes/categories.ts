import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { testCategories } from "../db/schema";
import { createCategorySchema, updateCategorySchema } from "../lib/types";
import { success, error } from "../lib/utils";
import { authMiddleware, adminOnly } from "../middleware/auth";

const categoriesRoute = new Hono();

// ─── GET /categories — list all categories ───────────────
// Both admin and staff can see (needed for sidebar + forms).

categoriesRoute.get("/", authMiddleware, async (c) => {
  const showAll = c.req.query("all") === "true";

  const categories = await db.query.testCategories.findMany({
    where: showAll ? undefined : eq(testCategories.isActive, true),
    orderBy: (t, { asc }) => [asc(t.sortOrder), asc(t.displayName)],
  });

  return c.json(success(categories));
});

// ─── GET /categories/:id — single category ───────────────

categoriesRoute.get("/:id", authMiddleware, async (c) => {
  const id = parseInt(c.req.param("id"));

  if (isNaN(id)) {
    return c.json(error("Invalid category ID"), 400);
  }

  const category = await db.query.testCategories.findFirst({
    where: eq(testCategories.id, id),
  });

  if (!category) {
    return c.json(error("Category not found"), 404);
  }

  return c.json(success(category));
});

// ─── POST /categories — create (admin only) ──────────────

categoriesRoute.post(
  "/",
  authMiddleware,
  adminOnly,
  zValidator("json", createCategorySchema),
  async (c) => {
    const data = c.req.valid("json");

    // Check for duplicate key or slug
    const existing = await db.query.testCategories.findFirst({
      where: eq(testCategories.key, data.key),
    });

    if (existing) {
      return c.json(error(`Category with key "${data.key}" already exists`), 409);
    }

    const [newCategory] = await db
      .insert(testCategories)
      .values(data)
      .returning();

    return c.json(success(newCategory), 201);
  }
);

// ─── PATCH /categories/:id — update (admin only) ─────────

categoriesRoute.patch(
  "/:id",
  authMiddleware,
  adminOnly,
  zValidator("json", updateCategorySchema),
  async (c) => {
    const id = parseInt(c.req.param("id"));
    const updates = c.req.valid("json");

    if (isNaN(id)) {
      return c.json(error("Invalid category ID"), 400);
    }

    const [updated] = await db
      .update(testCategories)
      .set(updates)
      .where(eq(testCategories.id, id))
      .returning();

    if (!updated) {
      return c.json(error("Category not found"), 404);
    }

    return c.json(success(updated));
  }
);

// ─── DELETE /categories/:id — deactivate (admin only) ────

categoriesRoute.delete("/:id", authMiddleware, adminOnly, async (c) => {
  const id = parseInt(c.req.param("id"));

  if (isNaN(id)) {
    return c.json(error("Invalid category ID"), 400);
  }

  // Soft delete — deactivate, don't remove (preserves existing orders)
  const [updated] = await db
    .update(testCategories)
    .set({ isActive: false })
    .where(eq(testCategories.id, id))
    .returning({ id: testCategories.id, displayName: testCategories.displayName });

  if (!updated) {
    return c.json(error("Category not found"), 404);
  }

  return c.json(success({ message: `${updated.displayName} deactivated` }));
});

export default categoriesRoute;
