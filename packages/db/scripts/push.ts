import "./load-env.js";
import { closeDb } from "../client.js";
import { applySchema } from "../migrate.js";

/**
 * `pnpm db:push`
 *
 * Second command in the zero-key acceptance path, so it has to succeed on a
 * cold checkout and on an existing database alike. Both halves are idempotent.
 */
async function main(): Promise<void> {
  const result = await applySchema();

  for (const f of result.migrationsSkipped) console.log(`  = ${f} (already applied)`);
  for (const f of result.migrationsApplied) console.log(`  + ${f}`);
  for (const f of result.policiesApplied) console.log(`  ~ policies/${f}`);

  const total = result.migrationsApplied.length + result.migrationsSkipped.length;
  console.log(`\nSchema is up to date (${total} migrations, ${result.policiesApplied.length} policy files).`);
  await closeDb();
}

main().catch(async (error: unknown) => {
  console.error("db:push failed\n", error);
  await closeDb();
  process.exit(1);
});
