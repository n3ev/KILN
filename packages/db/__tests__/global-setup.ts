import { rmSync } from "node:fs";
import { closeDb } from "../client.js";
import { applySchema } from "../migrate.js";

/**
 * Provisions a throwaway embedded Postgres for the suite.
 *
 * `KILN_PGDATA` is set in vitest.config.ts, which is evaluated before workers
 * spawn, so both this hook and the tests agree on the location. The directory
 * is destroyed first so a failed run never leaves state that makes the next
 * run pass for the wrong reason.
 */
export async function setup(): Promise<void> {
  const dir = process.env["KILN_PGDATA"];
  if (!dir) throw new Error("KILN_PGDATA must be set by vitest.config.ts before global setup runs.");

  rmSync(dir, { recursive: true, force: true });
  await applySchema();
  await closeDb();
}

export async function teardown(): Promise<void> {
  await closeDb();
}
