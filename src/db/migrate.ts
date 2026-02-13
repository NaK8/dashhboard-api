import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}

const migrationClient = postgres(connectionString, { max: 1 });
const db = drizzle(migrationClient);

async function runMigrations() {
  console.log("⏳ Running migrations...");

  await migrate(db, { migrationsFolder: "./drizzle" });

  console.log("✅ Migrations completed successfully");

  await migrationClient.end();
  process.exit(0);
}

runMigrations().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
