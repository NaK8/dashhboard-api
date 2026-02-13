import { createMiddleware } from "hono/factory";
import jwt from "jsonwebtoken";
import type { JWTPayload } from "../lib/types";

const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret";

// ─── Extend Hono context with our auth data ─────────────

declare module "hono" {
  interface ContextVariableMap {
    user: JWTPayload;
  }
}

// ─── Auth middleware — verifies JWT token ────────────────

export const authMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ success: false, error: "No token provided" }, 401);
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
    c.set("user", decoded);
    await next();
  } catch {
    return c.json({ success: false, error: "Invalid or expired token" }, 401);
  }
});

// ─── Admin-only middleware ───────────────────────────────

export const adminOnly = createMiddleware(async (c, next) => {
  const user = c.get("user");

  if (user.role !== "admin") {
    return c.json({ success: false, error: "Admin access required" }, 403);
  }

  await next();
});

// ─── Helper to sign tokens ──────────────────────────────

export function signToken(payload: Omit<JWTPayload, "iat" | "exp">): string {
  const expiresIn = process.env.JWT_EXPIRES_IN || "7d";
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: expiresIn as jwt.SignOptions["expiresIn"],
  });
}
