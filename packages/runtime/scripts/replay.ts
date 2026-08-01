import { asServiceRole, closeDb, getDb, rowsOf } from "@kiln/db";
import { sql } from "drizzle-orm";
import { fold } from "../events.js";

/**
 * `pnpm run:replay <runId>`
 *
 * Re-folds a run's event log against the CURRENT code and reports the state it
 * produces. This is the regression harness for prompt and schema changes: if a
 * change breaks the fold, or an artifact set no longer reconstructs, it shows
 * up here rather than in a customer's run.
 *
 * Tool execution during replay is forced into sandbox mode by the runtime, so a
 * replay can never re-charge a card or re-publish a store.
 */
async function main(): Promise<void> {
  const runId = process.argv[2];
  if (!runId) {
    console.error("Usage: pnpm run:replay <runId>");
    process.exit(1);
  }

  const db = await getDb();
  const { events, ventureId } = await asServiceRole(db, async (tx) => {
    const runRows = rowsOf<{ venture_id: string }>(
      await tx.execute(sql`SELECT venture_id FROM runs WHERE id = ${runId}`),
    );
    const venture = runRows[0]?.venture_id;
    if (!venture) throw new Error(`No run with id ${runId}`);

    const eventRows = rowsOf<{ id: string; seq: number; type: string; payload: unknown; actor: string; created_at: string }>(
      await tx.execute(sql`SELECT id, seq, type, payload, actor, created_at FROM run_events WHERE run_id = ${runId} ORDER BY seq ASC`),
    );
    return { events: eventRows, ventureId: venture };
  });

  const state = fold(
    { runId, ventureId } as never,
    events.map((e) => ({
      id: e.id,
      runId,
      seq: Number(e.seq),
      actor: e.actor,
      payload: e.payload,
      createdAt: new Date(e.created_at).toISOString(),
    })) as never,
  );

  console.log(`\nReplayed ${events.length} events for run ${runId}\n`);
  console.log(`  status        ${state.status}`);
  console.log(`  playbook      ${state.playbookId}@${state.playbookVersion}`);
  console.log(`  autonomy      ${state.autonomy}`);
  console.log(`  phases        ${state.phases.map((p) => `${p.key}:${p.status}`).join(", ") || "(none)"}`);
  console.log(`  artifacts     ${Object.keys(state.artifactsByType).join(", ") || "(none)"}`);
  console.log(`  spent         ${(state.spentMicros / 1_000_000).toFixed(4)}`);
  console.log(`  degraded      ${state.degraded}`);
  console.log(`  pending gates ${state.pendingCheckpointIds.length}\n`);

  await closeDb();
}

main().catch(async (error: unknown) => {
  console.error("replay failed\n", error);
  await closeDb();
  process.exit(1);
});
