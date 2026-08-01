import { randomUUID } from "node:crypto";
import { config } from "@kiln/config";
import {
  ARTIFACT_SCHEMAS,
  QualityReport,
  VentureBrief,
} from "@kiln/contracts";
import {
  applySchema,
} from "@kiln/db/migrate";
import {
  asServiceRole,
  closeDb,
  getDb,
  rowsOf,
} from "@kiln/db";
import { synthesize } from "@kiln/model-gateway";
import { declaredArtifacts } from "@kiln/runtime";
import { physicalShopify } from "@kiln/playbooks";
import { sql } from "drizzle-orm";
import { PostgresRunExecutor } from "../run-adapter.js";

interface DemoAccountRow {
  id: string;
}

async function main(): Promise<void> {
  await applySchema();
  const db = await getDb();
  const account = await asServiceRole(db, async (tx) =>
    rowsOf<DemoAccountRow>(
      await tx.execute(sql`
        SELECT account.id
        FROM accounts account
        JOIN plans plan ON plan.id = account.plan_id AND plan.active = true
        WHERE account.name = 'Demo Studio'
        LIMIT 1
      `),
    )[0],
  );
  if (!account) {
    throw new Error("Demo Studio is not seeded. Run `pnpm seed` once, then retry the worker demo.");
  }

  const ventureId = randomUUID();
  const runId = randomUUID();
  const seed = `worker-demo:${runId}`;
  const oneLiner =
    "I want to sell durable self-watering herb planters to apartment renters with sunny balconies.";
  const generated = synthesize(ARTIFACT_SCHEMAS.venture_brief, `${seed}:brief`);
  const brief = VentureBrief.parse({
    ...generated,
    oneLiner,
    workingName: "Balcony Plot",
    archetypeHint: {
      archetype: "physical",
      confidence: 0.98,
      reasoning: "The offer is a shipped physical product with a direct-to-consumer checkout.",
    },
  });

  await asServiceRole(db, async (tx) => {
    await tx.execute(sql`
      INSERT INTO ventures (id, account_id, name, archetype, status, ownership_mode, brief)
      VALUES (
        ${ventureId}, ${account.id}, ${`Balcony Plot ${runId.slice(0, 8)}`},
        'physical', 'building', 'managed', ${JSON.stringify(brief)}::jsonb
      )
    `);
    await tx.execute(sql`
      INSERT INTO runs
        (id, venture_id, playbook_id, playbook_version, status, autonomy,
         budget_micros, spent_micros, seed, sandbox, idempotency_key)
      VALUES
        (${runId}, ${ventureId}, ${physicalShopify.id}, ${physicalShopify.version},
         'queued', 'guided', ${physicalShopify.estimatedCostMicros}, 0,
         ${seed}, true, ${`worker-demo:${runId}`})
    `);
  });

  const result = await new PostgresRunExecutor().execute({
    runId,
    autoApproveSandboxCheckpoints: true,
  });
  if (result.status !== "succeeded") {
    throw new Error(`Worker demo stopped with status ${result.status}`);
  }

  const verification = await asServiceRole(db, async (tx) => {
    const run = rowsOf<{ status: string }>(
      await tx.execute(sql`SELECT status::text AS status FROM runs WHERE id = ${runId}`),
    )[0];
    const artifactRows = rowsOf<{ type: string; content: unknown }>(
      await tx.execute(sql`
        SELECT DISTINCT ON (type) type, content
        FROM artifacts
        WHERE run_id = ${runId}
        ORDER BY type, version DESC
      `),
    );
    const checkpoints = rowsOf<{ count: number }>(
      await tx.execute(sql`
        SELECT count(*)::int AS count FROM checkpoints
        WHERE run_id = ${runId} AND status = 'auto'
      `),
    )[0]?.count ?? 0;
    const events = rowsOf<{ count: number }>(
      await tx.execute(sql`SELECT count(*)::int AS count FROM run_events WHERE run_id = ${runId}`),
    )[0]?.count ?? 0;
    const streamedTokens = rowsOf<{ count: number }>(
      await tx.execute(sql`
        SELECT count(*)::int AS count FROM run_events
        WHERE run_id = ${runId} AND type = 'agent.token'
      `),
    )[0]?.count ?? 0;
    const invocations = rowsOf<{ count: number }>(
      await tx.execute(sql`
        SELECT count(*)::int AS count FROM agent_invocations invocation
        JOIN tasks task ON task.id = invocation.task_id
        JOIN phases phase ON phase.id = task.phase_id
        WHERE phase.run_id = ${runId} AND invocation.status = 'succeeded'
      `),
    )[0]?.count ?? 0;
    const modelLedgerEntries = rowsOf<{ count: number }>(
      await tx.execute(sql`
        SELECT count(*)::int AS count FROM cost_ledger
        WHERE run_id = ${runId} AND category = 'model'
      `),
    )[0]?.count ?? 0;
    return { run, artifactRows, checkpoints, events, streamedTokens, invocations, modelLedgerEntries };
  });

  if (verification.run?.status !== "succeeded") {
    throw new Error(`Persisted run status is ${verification.run?.status ?? "missing"}`);
  }
  const byType = new Map(verification.artifactRows.map((artifact) => [artifact.type, artifact.content]));
  const missing = declaredArtifacts(physicalShopify).filter((type) => !byType.has(type));
  if (missing.length > 0) throw new Error(`Worker demo is missing artifacts: ${missing.join(", ")}`);
  const quality = QualityReport.parse(byType.get("quality_report"));
  if (!quality.clearedForLaunch) throw new Error("Worker demo quality report did not clear launch");
  if (verification.checkpoints < physicalShopify.hardGates.length) {
    throw new Error(`Only ${verification.checkpoints}/${physicalShopify.hardGates.length} hard gates were persisted`);
  }
  if (verification.events === 0) throw new Error("Worker demo persisted no run events");
  if (verification.streamedTokens === 0) throw new Error("Worker demo persisted no streamed model tokens");
  if (verification.invocations === 0) throw new Error("Worker demo persisted no completed agent invocations");
  if (verification.modelLedgerEntries === 0) throw new Error("Worker demo persisted no model cost-ledger entries");

  const url = `${config().APP_URL.replace(/\/$/, "")}/runs/${runId}`;
  console.log(`Worker demo succeeded: ${runId}`);
  console.log(
    `Artifacts: ${declaredArtifacts(physicalShopify).length}; ` +
      `checkpoints: ${verification.checkpoints}; events: ${verification.events}; ` +
      `streamed tokens: ${verification.streamedTokens}; model ledger: ${verification.modelLedgerEntries}; quality cleared: true`,
  );
  console.log(`Run Theatre: ${url}`);
}

let failure: unknown;
try {
  await main();
} catch (error) {
  failure = error;
} finally {
  await closeDb();
}
if (failure !== undefined) {
  console.error(failure instanceof Error ? failure.message : String(failure));
  process.exitCode = 1;
}
