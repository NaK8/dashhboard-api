import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { validateEnv } from "./lib/validate-env";

// Validate environment variables before starting
validateEnv();
import { prettyJSON } from "hono/pretty-json";
import { secureHeaders } from "hono/secure-headers";
import { timing } from "hono/timing";
import { timeout } from "hono/timeout";
import { HTTPException } from "hono/http-exception";
import type { Context, Next } from "hono";

import authRoutes from "./routes/auth";
import categoriesRoutes from "./routes/categories";
import ordersRoutes from "./routes/orders";
import staffRoutes from "./routes/staff";
import testsRoutes from "./routes/tests";
import webhookRoutes from "./routes/webhook";

const app = new Hono();

// ─── Rate Limiting (in-memory) ───────────────────────────

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function rateLimit(maxRequests: number, windowMs: number) {
	return async (c: Context, next: Next) => {
		const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
		const routeKey = `${ip}:${c.req.path}`;
		const now = Date.now();
		const entry = rateLimitStore.get(routeKey);

		if (!entry || now > entry.resetAt) {
			rateLimitStore.set(routeKey, { count: 1, resetAt: now + windowMs });
		} else if (entry.count >= maxRequests) {
			c.header("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
			return c.json({ success: false, error: "Too many requests. Please try again later." }, 429);
		} else {
			entry.count++;
		}

		await next();
	};
}

// Clean up stale rate limit entries every 5 minutes
setInterval(() => {
	const now = Date.now();
	for (const [key, entry] of rateLimitStore) {
		if (now > entry.resetAt) rateLimitStore.delete(key);
	}
}, 5 * 60 * 1000);

// ─── Global Middleware ───────────────────────────────────

app.use("*", logger());
app.use("*", prettyJSON());
app.use("*", secureHeaders());
app.use("*", timing());

// Request timeout — 30 seconds max
app.use("*", timeout(30000, () => {
	return new HTTPException(408, {
		message: "Request timeout. Please try again.",
	});
}));

// CORS — support multiple origins (comma-separated in env)
const allowedOrigins = (process.env.DASHBOARD_URL || "https://dashboard.wellhealthlabs.com")
	.split(",")
	.map((o) => o.trim());

app.use(
	"*",
	cors({
		origin: (origin) => {
			if (allowedOrigins.includes(origin)) return origin;
			return allowedOrigins[0];
		},
		allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization"],
		credentials: true,
		maxAge: 86400,
	}),
);

// Rate limiting per route group
app.use("/auth/login", rateLimit(5, 60 * 1000));    // 5 req/min — brute-force protection
app.use("/webhook/*", rateLimit(30, 60 * 1000));     // 30 req/min — handle bursts
app.use("/orders/*", rateLimit(100, 60 * 1000));     // 100 req/min
app.use("/tests/*", rateLimit(100, 60 * 1000));
app.use("/categories/*", rateLimit(100, 60 * 1000));
app.use("/staff/*", rateLimit(100, 60 * 1000));

// ─── Health Check ────────────────────────────────────────

app.get("/", (c) => {
	return c.json({
		name: "Medical Dashboard API",
		version: "1.0.0",
		status: "running",
		timestamp: new Date().toISOString(),
	});
});

// ─── Routes ──────────────────────────────────────────────

app.route("/auth", authRoutes);
app.route("/categories", categoriesRoutes);
app.route("/webhook", webhookRoutes);
app.route("/orders", ordersRoutes);
app.route("/staff", staffRoutes);
app.route("/tests", testsRoutes);

// ─── 404 Handler ─────────────────────────────────────────

app.notFound((c) => {
	return c.json({ success: false, error: "Route not found" }, 404);
});

// ─── Global Error Handler ────────────────────────────────

app.onError((err, c) => {
	console.error(`❌ Unhandled error: ${err.message}`);
	console.error(err.stack);

	return c.json(
		{
			success: false,
			error:
				process.env.NODE_ENV === "production"
					? "Internal server error"
					: err.message,
		},
		500,
	);
});

// ─── Start Server ────────────────────────────────────────

const port = parseInt(process.env.PORT || "4000");

export default {
	port,
	fetch: app.fetch,
};
