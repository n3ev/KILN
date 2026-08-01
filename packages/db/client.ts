import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { config } from "@kiln/config";
import { sql } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import * as schema from "./schema/index.js";

/**
 * Database access.
 *
 * Two drivers, one type. With no DATABASE_URL set, KILN runs an embedded
 * Postgres 16 (PGlite, the real engine compiled to WASM) under `.kiln/pgdata`,
 * which is what lets `pnpm db:push && pnpm seed && pnpm dev` succeed with no
 * Docker and no network. With DATABASE_URL set it is ordinary postgres-js.
 *
 * The embedded engine holds an exclusive lock on its data directory, so only
 * one process may open it. Multi-process local operation therefore uses the
 * Docker Postgres service; see docs/adr/0005-sandbox-first-architecture.md.
 */
export type Database =
  | PgliteDatabase<typeof schema>
  | PostgresJsDatabase<typeof schema>;

export { schema };

/** Walks up from cwd to the workspace root so paths work from any package. */
export function repoRoot(from: string = process.cwd()): string {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(from);
    dir = parent;
  }
}

export function embeddedDataDir(): string {
  return config().KILN_PGDATA ?? join(repoRoot(), ".kiln", "pgdata");
}

interface Driver {
  db: Database;
  close: () => Promise<void>;
  /**
   * Runs a multi-statement SQL script. Needed because neither driver's normal
   * query path accepts one: PGlite parses through prepared statements, which
   * reject multiple commands, and postgres-js requires simple protocol. Both
   * expose an escape hatch, and this is the only place that knows which.
   */
  execScript: (source: string) => Promise<void>;
}

let instance: Driver | undefined;

async function createEmbedded(): Promise<Driver> {
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = embeddedDataDir();
  // PGlite's own mkdir is not recursive, so a cold checkout fails on the
  // missing `.kiln` parent rather than on anything meaningful.
  mkdirSync(dirname(dir), { recursive: true });
  const client = new PGlite(dir);
  await client.waitReady;
  return {
    db: drizzlePglite(client, { schema }),
    close: async () => client.close(),
    execScript: async (source) => {
      await client.exec(source);
    },
  };
}

async function createRemote(url: string): Promise<Driver> {
  const postgres = (await import("postgres")).default;
  const client = postgres(url, { max: config().PGPOOL_MAX, onnotice: () => {} });
  return {
    db: drizzlePostgres(client, { schema }),
    close: async () => client.end({ timeout: 5 }),
    execScript: async (source) => {
      await client.unsafe(source).simple();
    },
  };
}

async function driver(): Promise<Driver> {
  instance ??= config().DATABASE_URL
    ? await createRemote(config().DATABASE_URL as string)
    : await createEmbedded();
  return instance;
}

/** Process-wide singleton. Safe to call from anywhere, including request paths. */
export async function getDb(): Promise<Database> {
  return (await driver()).db;
}

/** Applies a whole `.sql` file. Used by db:push for migrations and policies. */
export async function execScript(source: string): Promise<void> {
  await (await driver()).execScript(source);
}

/**
 * Normalises the result of a raw `db.execute`.
 *
 * The two drivers disagree: postgres-js resolves to an array of rows, PGlite to
 * a `{ rows }` envelope. Drizzle does not paper over it for raw SQL, so every
 * raw query in KILN goes through here rather than each caller guessing.
 */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result !== null && typeof result === "object") {
    const maybe = (result as { rows?: unknown }).rows;
    if (Array.isArray(maybe)) return maybe as T[];
  }
  return [];
}

export async function closeDb(): Promise<void> {
  await instance?.close();
  instance = undefined;
}

/**
 * Runs `fn` with the tenant GUC set, so RLS applies.
 *
 * `SET LOCAL` is transaction-scoped, which is the only safe choice on a pooled
 * connection — a plain SET would leak the account id into whatever request
 * borrows the connection next.
 */
export async function withAccount<T>(
  db: Database,
  accountId: string,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // The embedded and server-side connections own the tables (and are often
    // superusers), so setting only the tenant GUC would still bypass RLS. Drop
    // to the real authenticated role first; it is not a member of service_role.
    await tx.execute(sql.raw("SET LOCAL ROLE authenticated"));
    await tx.execute(sql`SELECT set_config('kiln.account_id', ${accountId}, true)`);
    return fn(tx as unknown as Database);
  });
}

/**
 * Elevates to the service role for the duration of `fn`. Workers, migrations,
 * and the vault use this; request paths must not.
 */
export async function asServiceRole<T>(db: Database, fn: (tx: Database) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    // This is an actual Postgres role transition, not a forgeable session flag.
    // The migration/bootstrap connection may assume service_role; authenticated
    // cannot, because it has no membership grant.
    await tx.execute(sql.raw("SET LOCAL ROLE service_role"));
    return fn(tx as unknown as Database);
  });
}
