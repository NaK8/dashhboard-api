import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { secureHeaders } from "hono/secure-headers";
import { timing } from "hono/timing";

import authRoutes from "./routes/auth";
import ordersRoutes from "./routes/orders";
import staffRoutes from "./routes/staff";
import testsRoutes from "./routes/tests";
import webhookRoutes from "./routes/webhook";

const app = new Hono();

// ─── Global Middleware ───────────────────────────────────

app.use("*", logger());
app.use("*", prettyJSON());
app.use("*", secureHeaders());
app.use("*", timing());

// CORS — allow your dashboard domain
app.use(
	"*",
	cors({
		origin: process.env.DASHBOARD_URL || "http://localhost:5173",
		allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization"],
		credentials: true,
		maxAge: 86400,
	}),
);

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

const port = parseInt(process.env.PORT || "3000");

console.log(`
╔══════════════════════════════════════════╗
║     Medical Dashboard API                ║
║     Running on http://localhost:${port}      ║
╚══════════════════════════════════════════╝
`);

export default {
	port,
	fetch: app.fetch,
};
