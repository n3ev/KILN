import { rmSync } from "node:fs";
import { closeDb } from "@kiln/db";
import { applySchema } from "@kiln/db/migrate";

export async function setup(): Promise<void> {
  const pgdata = process.env["KILN_PGDATA"];
  const keyfile = process.env["KILN_KEYFILE"];
  if (!pgdata || !keyfile) throw new Error("Vault tests require isolated KILN_PGDATA and KILN_KEYFILE paths.");
  rmSync(pgdata, { recursive: true, force: true });
  rmSync(keyfile, { force: true });
  await applySchema();
  await closeDb();
}

export async function teardown(): Promise<void> {
  await closeDb();
}
