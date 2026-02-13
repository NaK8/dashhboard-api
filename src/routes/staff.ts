import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { staff } from "../db/schema";
import { createStaffSchema, updateStaffSchema } from "../lib/types";
import { success, error } from "../lib/utils";
import { authMiddleware, adminOnly } from "../middleware/auth";

const staffRoutes = new Hono();

// All routes require auth + admin
staffRoutes.use("*", authMiddleware, adminOnly);

// ─── GET /staff — list all staff ─────────────────────────

staffRoutes.get("/", async (c) => {
  const members = await db.query.staff.findMany({
    columns: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
    orderBy: (staff, { asc }) => [asc(staff.name)],
  });

  return c.json(success(members));
});

// ─── POST /staff — create new staff member ───────────────

staffRoutes.post("/", zValidator("json", createStaffSchema), async (c) => {
  const data = c.req.valid("json");

  // Check if email already exists
  const existing = await db.query.staff.findFirst({
    where: eq(staff.email, data.email),
  });

  if (existing) {
    return c.json(error("Email already in use"), 409);
  }

  const passwordHash = await bcrypt.hash(data.password, 12);

  const [newStaff] = await db
    .insert(staff)
    .values({
      name: data.name,
      email: data.email,
      passwordHash,
      role: data.role,
    })
    .returning({
      id: staff.id,
      name: staff.name,
      email: staff.email,
      role: staff.role,
      createdAt: staff.createdAt,
    });

  return c.json(success(newStaff), 201);
});

// ─── PATCH /staff/:id — update staff member ──────────────

staffRoutes.patch("/:id", zValidator("json", updateStaffSchema), async (c) => {
  const id = parseInt(c.req.param("id"));
  const updates = c.req.valid("json");

  if (isNaN(id)) {
    return c.json(error("Invalid staff ID"), 400);
  }

  const [updated] = await db
    .update(staff)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(staff.id, id))
    .returning({
      id: staff.id,
      name: staff.name,
      email: staff.email,
      role: staff.role,
      isActive: staff.isActive,
    });

  if (!updated) {
    return c.json(error("Staff member not found"), 404);
  }

  return c.json(success(updated));
});

// ─── DELETE /staff/:id — deactivate staff ────────────────

staffRoutes.delete("/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  const currentUser = c.get("user");

  if (isNaN(id)) {
    return c.json(error("Invalid staff ID"), 400);
  }

  // Prevent self-deletion
  if (currentUser.id === id) {
    return c.json(error("Cannot deactivate your own account"), 400);
  }

  // Soft delete — deactivate instead of removing
  const [updated] = await db
    .update(staff)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(staff.id, id))
    .returning({ id: staff.id, name: staff.name });

  if (!updated) {
    return c.json(error("Staff member not found"), 404);
  }

  return c.json(success({ message: `${updated.name} has been deactivated` }));
});

export default staffRoutes;
