import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { execScript, getDb, repoRoot, rowsOf } from "./client.js";

/**
 * Applies generated migrations and hand-written policies.
 *
 * Lives here rather than in scripts/push.ts so that the test harness provisions
 * its database through exactly the same code path the developer command uses.
 * A test suite that migrates differently from production is a test suite that
 * passes while the real thing is broken.
 */

export interface SchemaApplyResult {
  migrationsApplied: string[];
  migrationsSkipped: string[];
  policiesApplied: string[];
}

/** Splits on drizzle's statement breakpoints; whole file when absent. */
function statements(source: string): string[] {
  if (!source.includes("--> statement-breakpoint")) return [source];
  return source
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
}

function listSql(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch {
    return [];
  }
}

export async function applySchema(dbDir = join(repoRoot(), "packages", "db")): Promise<SchemaApplyResult> {
  const db = await getDb();

  await execScript(`CREATE TABLE IF NOT EXISTS kiln_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  );`);

  const applied = new Set<string>();
  for (const row of rowsOf<{ name: string }>(await db.execute(sql`SELECT name FROM kiln_migrations`))) {
    applied.add(row.name);
  }

  const migrationsDir = join(dbDir, "migrations");
  const migrationFiles = listSql(migrationsDir);
  if (migrationFiles.length === 0) {
    throw new Error(
      `No migrations in ${migrationsDir}. Run \`pnpm db:generate\` — it emits SQL from the ` +
        `Drizzle schema and needs no database connection.`,
    );
  }

  const migrationsApplied: string[] = [];
  const migrationsSkipped: string[] = [];

  for (const file of migrationFiles) {
    if (applied.has(file)) {
      migrationsSkipped.push(file);
      continue;
    }
    for (const stmt of statements(readFileSync(join(migrationsDir, file), "utf8"))) {
      await execScript(stmt);
    }
    await db.execute(sql`INSERT INTO kiln_migrations (name) VALUES (${file})`);
    migrationsApplied.push(file);
  }

  // Policies are re-applied every time on purpose: they are written to be
  // idempotent, and re-running them is how a policy edit reaches an existing
  // database without a new migration.
  const policiesDir = join(dbDir, "policies");
  const policiesApplied: string[] = [];
  for (const file of listSql(policiesDir)) {
    await execScript(readFileSync(join(policiesDir, file), "utf8"));
    policiesApplied.push(file);
  }

  return { migrationsApplied, migrationsSkipped, policiesApplied };
}
