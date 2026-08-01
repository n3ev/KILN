import { defineConfig } from "drizzle-kit";

/**
 * Used only by `drizzle-kit generate`, which reads the schema and emits SQL
 * without touching a database. Applying that SQL — plus the policy files — is
 * `scripts/push.ts`, so the same code path works against embedded Postgres and
 * a remote one.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./schema/index.ts",
  out: "./migrations",
  casing: "snake_case",
  verbose: true,
  strict: false,
  dbCredentials: {
    url: process.env["DATABASE_URL"] ?? "postgresql://localhost:5432/kiln",
  },
});
