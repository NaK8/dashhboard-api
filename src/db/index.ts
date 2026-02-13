import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}

// Connection pool for queries
const queryClient = postgres(connectionString, {
  max: 20, // max pool size
  idle_timeout: 20, // close idle connections after 20s
  connect_timeout: 10,
});

export const db = drizzle(queryClient, { schema });

// Separate client for migrations (single connection)
export const createMigrationClient = () => {
  return postgres(connectionString!, { max: 1 });
};
