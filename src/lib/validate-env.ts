import { z } from "zod";

/**
 * Validate required environment variables at startup.
 * Fails fast with a clear error if anything is missing,
 * preventing the server from running with bad config.
 */

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  WEBHOOK_SECRET: z.string().min(1, "WEBHOOK_SECRET is required"),
  DASHBOARD_URL: z.string().optional(),
  PORT: z.string().optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).optional(),
  JWT_EXPIRES_IN: z.string().optional(),
});

export function validateEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error("❌ Environment variable validation failed:");
    for (const issue of result.error.issues) {
      console.error(`   ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  // Warn if using the default JWT secret (very dangerous in production)
  if (process.env.JWT_SECRET === "change-this-secret") {
    if (process.env.NODE_ENV === "production") {
      console.error("❌ FATAL: JWT_SECRET cannot be 'change-this-secret' in production!");
      process.exit(1);
    }
    console.warn("⚠️  WARNING: Using default JWT_SECRET. Set a strong secret for production.");
  }

  console.log("✅ Environment variables validated");
  return result.data;
}
