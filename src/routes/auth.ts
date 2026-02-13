import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { staff } from "../db/schema";
import { loginSchema } from "../lib/types";
import { success, error } from "../lib/utils";
import { authMiddleware, signToken } from "../middleware/auth";

const auth = new Hono();

// ─── POST /auth/login ────────────────────────────────────

auth.post("/login", zValidator("json", loginSchema), async (c) => {
  const { email, password } = c.req.valid("json");

  const user = await db.query.staff.findFirst({
    where: eq(staff.email, email),
  });

  if (!user) {
    return c.json(error("Invalid email or password"), 401);
  }

  if (!user.isActive) {
    return c.json(error("Account is deactivated. Contact admin."), 403);
  }

  const validPassword = await bcrypt.compare(password, user.passwordHash);
  if (!validPassword) {
    return c.json(error("Invalid email or password"), 401);
  }

  const token = signToken({
    id: user.id,
    email: user.email,
    role: user.role,
  });

  return c.json(
    success({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    })
  );
});

// ─── GET /auth/me — get current user profile ─────────────

auth.get("/me", authMiddleware, async (c) => {
  const payload = c.get("user");

  const user = await db.query.staff.findFirst({
    where: eq(staff.id, payload.id),
    columns: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
    },
  });

  if (!user) {
    return c.json(error("User not found"), 404);
  }

  return c.json(success(user));
});

// ─── POST /auth/change-password ──────────────────────────

auth.post(
  "/change-password",
  authMiddleware,
  zValidator(
    "json",
    loginSchema.pick({ password: true }).extend({
      newPassword: loginSchema.shape.password,
    })
  ),
  async (c) => {
    const { password, newPassword } = c.req.valid("json") as {
      password: string;
      newPassword: string;
    };
    const payload = c.get("user");

    const user = await db.query.staff.findFirst({
      where: eq(staff.id, payload.id),
    });

    if (!user) {
      return c.json(error("User not found"), 404);
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      return c.json(error("Current password is incorrect"), 401);
    }

    const newHash = await bcrypt.hash(newPassword, 12);

    await db.update(staff).set({ passwordHash: newHash }).where(eq(staff.id, payload.id));

    return c.json(success({ message: "Password changed successfully" }));
  }
);

export default auth;
