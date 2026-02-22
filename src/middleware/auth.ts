import { createMiddleware } from "hono/factory";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { staff } from "../db/schema";
import type { JWTPayload } from "../lib/types";

const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret";

// ─── Extend Hono context with our auth data ─────────────

declare module "hono" {
  interface ContextVariableMap {
    user: JWTPayload;
  }
}

// ─── In-memory cache for active user checks ─────────────
// Avoids a DB hit on every request. TTL = 5 minutes.

const activeUserCache = new Map<number, { isActive: boolean; expiresAt: number }>();

async function isUserActive(userId: number): Promise<boolean> {
  const cached = activeUserCache.get(userId);
  const now = Date.now();

  if (cached && now < cached.expiresAt) {
    return cached.isActive;
  }

  const user = await db.query.staff.findFirst({
    where: eq(staff.id, userId),
    columns: { isActive: true },
  });

  const isActive = user?.isActive ?? false;
  activeUserCache.set(userId, { isActive, expiresAt: now + 5 * 60 * 1000 });

  return isActive;
}

// Clean up stale cache entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of activeUserCache) {
    if (now > entry.expiresAt) activeUserCache.delete(key);
  }
}, 10 * 60 * 1000);

// ─── Auth middleware — verifies JWT token ────────────────

export const authMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ success: false, error: "No token provided" }, 401);
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;

    // Check that the user still exists and is active
    const active = await isUserActive(decoded.id);
    if (!active) {
      return c.json({ success: false, error: "Account is deactivated" }, 403);
    }

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
