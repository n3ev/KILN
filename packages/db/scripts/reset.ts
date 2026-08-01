import { rmSync } from "node:fs";
import { config } from "@kiln/config";
import { sql } from "drizzle-orm";
import { asServiceRole, closeDb, embeddedDataDir, getDb } from "../client.js";

/**
 * `pnpm db:reset` — destroys all data and returns to an empty schema.
 *
 * On the embedded database this deletes the data directory outright. On a
 * remote one it drops the public and kiln schemas, and it refuses to run at all
 * in production, because a reset script that can be pointed at a live customer
 * database is a loaded gun on the workbench.
 */
async function main(): Promise<void> {
  const cfg = config();

  if (cfg.NODE_ENV === "production") {
    console.error("db:reset refuses to run with NODE_ENV=production.");
    process.exit(1);
  }

  if (cfg.embeddedDatabase) {
    const dir = embeddedDataDir();
    rmSync(dir, { recursive: true, force: true });
    console.log(`Removed embedded database at ${dir}`);
    return;
  }

  console.log(`Dropping schemas on ${new URL(cfg.DATABASE_URL ?? "").host}...`);
  const db = await getDb();
  await asServiceRole(db, async (tx) => {
    await tx.execute(sql`DROP SCHEMA IF EXISTS kiln CASCADE`);
    await tx.execute(sql`DROP SCHEMA public CASCADE`);
    await tx.execute(sql`CREATE SCHEMA public`);
  });
  await closeDb();
  console.log("Done. Run `pnpm db:push && pnpm seed`.");
}

main().catch(async (error: unknown) => {
  console.error("db:reset failed\n", error);
  await closeDb();
  process.exit(1);
});
