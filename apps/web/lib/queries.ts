import { Checkpoint, RunEvent, RunEventRecord, type Checkpoint as CheckpointValue, type RunEventRecord as RunEventRecordValue } from "@kiln/contracts";
import { assertAccountAccess, rowsOf, type Database } from "@kiln/db";
import { PostgresJobQueue } from "@kiln/jobs";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withSessionAccount } from "./session";
import { ArtifactView, RunView, type ArtifactView as ArtifactValue, type RunView as RunValue } from "./view-contracts";

const runQueue = new PostgresJobQueue({ workerId: "web-checkpoint" });

const Uuid = z.string().uuid();
const NumberLike = z.union([z.number(), z.string(), z.bigint()]).transform((value) => Number(value));
const DateLike = z.union([z.date(), z.string(), z.number()]).transform((value) => new Date(value).toISOString());
const JsonLike = z.unknown().transform((value, ctx): unknown => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalid JSON value" });
    return z.NEVER;
  }
});

const VentureRow = z.object({
  id: Uuid,
  name: z.string(),
  archetype: z.string(),
  status: z.string(),
  ownership_mode: z.string(),
  primary_domain: z.string().nullable(),
  created_at: DateLike,
});
export type VentureRow = z.infer<typeof VentureRow>;

const RawRun = z.object({
  id: Uuid,
  venture_id: Uuid,
  venture_name: z.string(),
  playbook_id: z.string(),
  status: z.string(),
  autonomy: z.string(),
  current_phase: z.string().nullable(),
  spent_micros: NumberLike,
  budget_micros: NumberLike,
  started_at: z.union([z.date(), z.string(), z.number()]).nullable(),
  ended_at: z.union([z.date(), z.string(), z.number()]).nullable(),
});

const toRunView = (row: unknown): RunValue => {
  const raw = RawRun.parse(row);
  return RunView.parse({
    id: raw.id,
    ventureId: raw.venture_id,
    ventureName: raw.venture_name,
    playbookId: raw.playbook_id,
    status: raw.status,
    autonomy: raw.autonomy,
    currentPhase: raw.current_phase,
    spentMicros: raw.spent_micros,
    budgetMicros: raw.budget_micros,
    startedAt: raw.started_at === null ? null : new Date(raw.started_at).toISOString(),
    endedAt: raw.ended_at === null ? null : new Date(raw.ended_at).toISOString(),
  });
};

export async function listVentures(): Promise<VentureRow[]> {
  return withSessionAccount(async (tx, session) =>
    rowsOf<unknown>(await tx.execute(sql`
      SELECT id, name, archetype, status, ownership_mode, primary_domain, created_at
      FROM ventures WHERE account_id = ${session.accountId} ORDER BY created_at DESC
    `)).map((row) => VentureRow.parse(row)),
  );
}

export async function getVenture(id: string): Promise<VentureRow | undefined> {
  if (!Uuid.safeParse(id).success) return undefined;
  return withSessionAccount(async (tx, session) => {
    const row = rowsOf<unknown>(await tx.execute(sql`
      SELECT id, name, archetype, status, ownership_mode, primary_domain, created_at
      FROM ventures WHERE id = ${id} AND account_id = ${session.accountId}
    `))[0];
    return row === undefined ? undefined : VentureRow.parse(row);
  });
}

const runSelect = sql.raw(`
  SELECT r.id, r.venture_id, v.name AS venture_name, r.playbook_id, r.status, r.autonomy,
         r.current_phase, r.spent_micros, r.budget_micros, r.started_at, r.ended_at
  FROM runs r JOIN ventures v ON v.id = r.venture_id
`);

export async function listRuns(): Promise<RunValue[]> {
  return withSessionAccount(async (tx, session) =>
    rowsOf<unknown>(await tx.execute(sql`${runSelect}
      WHERE v.account_id = ${session.accountId} ORDER BY r.created_at DESC
    `)).map(toRunView),
  );
}

export async function getRun(id: string): Promise<RunValue | undefined> {
  if (!Uuid.safeParse(id).success) return undefined;
  return withSessionAccount(async (tx, session) => {
    const row = rowsOf<unknown>(await tx.execute(sql`${runSelect}
      WHERE r.id = ${id} AND v.account_id = ${session.accountId}
    `))[0];
    return row === undefined ? undefined : toRunView(row);
  });
}

const RawEvent = z.object({
  id: Uuid,
  run_id: Uuid,
  seq: NumberLike,
  type: z.string(),
  payload: JsonLike,
  actor: z.enum(["agent", "tool", "human", "system"]),
  created_at: DateLike,
});

const toEvent = (row: unknown): RunEventRecordValue => {
  const raw = RawEvent.parse(row);
  const payload = RunEvent.parse(raw.payload);
  if (payload.type !== raw.type) throw new Error(`Run event ${raw.seq} has a mismatched type.`);
  return RunEventRecord.parse({
    id: raw.id,
    runId: raw.run_id,
    seq: raw.seq,
    actor: raw.actor,
    payload,
    createdAt: raw.created_at,
  });
};

export async function listRunEvents(runId: string, afterSeq = -1, limit?: number): Promise<RunEventRecordValue[]> {
  if (!Uuid.safeParse(runId).success) return [];
  const boundedLimit = limit === undefined ? undefined : Math.max(1, Math.min(500, Math.floor(limit)));
  return withSessionAccount(async (tx, session) => {
    const rows = boundedLimit === undefined
      ? rowsOf<unknown>(await tx.execute(sql`
          SELECT e.id, e.run_id, e.seq, e.type, e.payload, e.actor, e.created_at
          FROM run_events e JOIN runs r ON r.id = e.run_id JOIN ventures v ON v.id = r.venture_id
          WHERE e.run_id = ${runId} AND v.account_id = ${session.accountId} AND e.seq > ${afterSeq}
          ORDER BY e.seq ASC
        `))
      : rowsOf<unknown>(await tx.execute(sql`
          SELECT e.id, e.run_id, e.seq, e.type, e.payload, e.actor, e.created_at
          FROM run_events e JOIN runs r ON r.id = e.run_id JOIN ventures v ON v.id = r.venture_id
          WHERE e.run_id = ${runId} AND v.account_id = ${session.accountId} AND e.seq > ${afterSeq}
          ORDER BY e.seq ASC LIMIT ${boundedLimit}
        `));
    return rows.map(toEvent);
  });
}

const RawArtifact = z.object({
  id: Uuid,
  run_id: Uuid,
  type: z.string(),
  version: NumberLike,
  status: z.string(),
  content: JsonLike,
  quality: JsonLike,
  created_at: DateLike,
});

const toArtifact = (row: unknown): ArtifactValue => {
  const raw = RawArtifact.parse(row);
  return ArtifactView.parse({
    id: raw.id,
    runId: raw.run_id,
    type: raw.type,
    version: raw.version,
    status: raw.status,
    content: raw.content,
    quality: raw.quality,
    createdAt: raw.created_at,
  });
};

export async function listArtifacts(runId: string): Promise<ArtifactValue[]> {
  if (!Uuid.safeParse(runId).success) return [];
  return withSessionAccount(async (tx, session) =>
    rowsOf<unknown>(await tx.execute(sql`
      SELECT a.id, a.run_id, a.type, a.version, a.status, a.content, a.quality, a.created_at
      FROM artifacts a JOIN ventures v ON v.id = a.venture_id
      WHERE a.run_id = ${runId} AND v.account_id = ${session.accountId}
      ORDER BY a.created_at ASC
    `)).map(toArtifact),
  );
}

export async function getArtifact(runId: string, artifactId: string): Promise<ArtifactValue | undefined> {
  if (!Uuid.safeParse(runId).success || !Uuid.safeParse(artifactId).success) return undefined;
  return withSessionAccount(async (tx, session) => {
    const row = rowsOf<unknown>(await tx.execute(sql`
      SELECT a.id, a.run_id, a.type, a.version, a.status, a.content, a.quality, a.created_at
      FROM artifacts a JOIN ventures v ON v.id = a.venture_id
      WHERE a.id = ${artifactId} AND a.run_id = ${runId} AND v.account_id = ${session.accountId}
    `))[0];
    return row === undefined ? undefined : toArtifact(row);
  });
}

const MetricPoint = z.object({
  metric_key: z.string(),
  ts: DateLike,
  value: z.union([z.string(), z.number()]).transform(String),
  currency: z.string().nullable(),
});
export type MetricPoint = z.infer<typeof MetricPoint>;

export async function ventureMetrics(ventureId: string, days = 30): Promise<MetricPoint[]> {
  if (!Uuid.safeParse(ventureId).success) return [];
  const safeDays = Math.max(1, Math.min(365, Math.floor(days)));
  return withSessionAccount(async (tx, session) =>
    rowsOf<unknown>(await tx.execute(sql`
      SELECT m.metric_key, m.ts, m.value, m.currency FROM metric_snapshots m
      JOIN ventures v ON v.id = m.venture_id
      WHERE m.venture_id = ${ventureId} AND v.account_id = ${session.accountId}
        AND m.ts > now() - (${safeDays} || ' days')::interval
      ORDER BY m.ts ASC
    `)).map((row) => MetricPoint.parse(row)),
  );
}

const RawCheckpoint = z.object({
  id: Uuid,
  run_id: Uuid,
  phase_id: Uuid.nullable(),
  kind: z.string(),
  title: z.string(),
  prompt: JsonLike,
  options: JsonLike,
  status: z.string(),
  decided_by_user_id: Uuid.nullable(),
  decision: JsonLike.nullable(),
  expires_at: DateLike,
  created_at: DateLike,
  decided_at: z.union([z.date(), z.string(), z.number()]).nullable(),
});

const toCheckpoint = (row: unknown): CheckpointValue => {
  const raw = RawCheckpoint.parse(row);
  return Checkpoint.parse({
    id: raw.id,
    runId: raw.run_id,
    ...(raw.phase_id ? { phaseId: raw.phase_id } : {}),
    kind: raw.kind,
    title: raw.title,
    prompt: raw.prompt,
    options: raw.options,
    status: raw.status,
    ...(raw.decided_by_user_id ? { decidedByUserId: raw.decided_by_user_id } : {}),
    ...(raw.decision ? { decision: raw.decision } : {}),
    expiresAt: raw.expires_at,
    createdAt: raw.created_at,
    ...(raw.decided_at ? { decidedAt: new Date(raw.decided_at).toISOString() } : {}),
  });
};

const checkpointSelect = sql.raw(`
  SELECT c.id, c.run_id, c.phase_id, c.kind, c.title, c.prompt, c.options, c.status,
         c.decided_by_user_id, c.decision, c.expires_at, c.created_at, c.decided_at
  FROM checkpoints c JOIN runs r ON r.id = c.run_id JOIN ventures v ON v.id = r.venture_id
`);

export async function listPendingCheckpoints(): Promise<CheckpointValue[]> {
  return withSessionAccount(async (tx, session) =>
    rowsOf<unknown>(await tx.execute(sql`${checkpointSelect}
      WHERE v.account_id = ${session.accountId} AND c.status = 'pending'
      ORDER BY c.expires_at ASC
    `)).map(toCheckpoint),
  );
}

export async function listRunCheckpoints(runId: string): Promise<CheckpointValue[]> {
  if (!Uuid.safeParse(runId).success) return [];
  return withSessionAccount(async (tx, session) =>
    rowsOf<unknown>(await tx.execute(sql`${checkpointSelect}
      WHERE c.run_id = ${runId} AND v.account_id = ${session.accountId}
      ORDER BY c.created_at ASC
    `)).map(toCheckpoint),
  );
}

async function selectCheckpoint(tx: Database, accountId: string, checkpointId: string): Promise<CheckpointValue | undefined> {
  const row = rowsOf<unknown>(await tx.execute(sql`${checkpointSelect}
    WHERE c.id = ${checkpointId} AND v.account_id = ${accountId}
  `))[0];
  return row === undefined ? undefined : toCheckpoint(row);
}

export async function decideCheckpoint(
  checkpointId: string,
  input: { status: "approved" | "rejected"; optionId?: string; note?: string },
): Promise<CheckpointValue | undefined> {
  if (!Uuid.safeParse(checkpointId).success) return undefined;
  const outcome = await withSessionAccount(async (tx, session) => {
    await assertAccountAccess(tx, session.accountId, "checkpoint", checkpointId);
    const checkpoint = await selectCheckpoint(tx, session.accountId, checkpointId);
    if (!checkpoint) return { checkpoint: undefined, resume: false };
    if (checkpoint.status !== "pending") {
      return { checkpoint, resume: checkpoint.status === "approved" || checkpoint.status === "auto" };
    }
    if (
      input.status === "approved" &&
      checkpoint.prompt.notBefore &&
      new Date(checkpoint.prompt.notBefore).getTime() > Date.now()
    ) {
      throw new Error("This autonomous veto window has not elapsed yet. You can veto it now, or let it proceed automatically.");
    }
    if (input.optionId && !checkpoint.options.some((option) => option.id === input.optionId)) {
      throw new Error("The selected checkpoint option does not exist.");
    }
    const decision = { ...(input.optionId ? { optionId: input.optionId } : {}), ...(input.note ? { note: input.note } : {}) };
    await tx.execute(sql`
      UPDATE checkpoints SET status = ${input.status}, decided_by_user_id = ${session.userId},
        decision = ${JSON.stringify(decision)}::jsonb, decided_at = now()
      WHERE id = ${checkpointId} AND status = 'pending'
    `);
    const event = RunEvent.parse({
      type: "checkpoint.decided",
      checkpointId,
      status: input.status,
      ...(input.optionId ? { optionId: input.optionId } : {}),
      byUserId: session.userId,
    });
    await tx.execute(sql`
      INSERT INTO run_events (run_id, type, payload, actor)
      VALUES (${checkpoint.runId}, ${event.type}, ${JSON.stringify(event)}::jsonb, 'human')
    `);
    if (input.status === "rejected") {
      const paused = RunEvent.parse({ type: "run.paused", reason: `Checkpoint ${checkpointId} was rejected` });
      await tx.execute(sql`
        INSERT INTO run_events (run_id, type, payload, actor)
        VALUES (${checkpoint.runId}, ${paused.type}, ${JSON.stringify(paused)}::jsonb, 'human')
      `);
      await tx.execute(sql`UPDATE runs SET status = 'paused' WHERE id = ${checkpoint.runId}`);
    } else {
      await tx.execute(sql`
        UPDATE runs SET status = CASE
          WHEN EXISTS (
            SELECT 1 FROM checkpoints
            WHERE run_id = ${checkpoint.runId} AND status = 'pending'
          ) THEN 'waiting_on_checkpoint'::run_status ELSE 'queued'::run_status END
        WHERE id = ${checkpoint.runId}
      `);
    }
    return {
      checkpoint: await selectCheckpoint(tx, session.accountId, checkpointId),
      resume: input.status === "approved",
    };
  });
  if (outcome.resume && outcome.checkpoint) {
    await runQueue.enqueue(
      "run.execute",
      { runId: outcome.checkpoint.runId, autoApproveSandboxCheckpoints: false },
      { idempotencyKey: `run:${outcome.checkpoint.runId}:checkpoint:${outcome.checkpoint.id}`, maxAttempts: 3 },
    );
  }
  return outcome.checkpoint;
}
