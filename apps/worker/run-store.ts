import { createHash, randomUUID } from "node:crypto";
import {
  ArtifactQuality,
  ArtifactType,
  CheckpointKind,
  RunEvent,
  RunEventRecord,
  parseArtifactContent,
  type RunEvent as RunEventValue,
  type RunState,
} from "@kiln/contracts";
import { asServiceRole, getDb, rowsOf, type Database } from "@kiln/db";
import { fold, type OrchestratorDeps } from "@kiln/runtime";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { RunRow } from "./run-data.js";
import { projectRunEvent } from "./run-projector.js";

type EventActor = "agent" | "tool" | "human" | "system";

interface EventRow {
  id: string;
  runId: string;
  seq: number | string | bigint;
  actor: EventActor;
  payload: unknown;
  createdAt: Date | string;
}

interface ExistingArtifactRow {
  id: string;
  version: number;
}

interface CheckpointRow {
  id: string;
  status: "pending" | "approved" | "rejected" | "expired" | "auto";
  decision: unknown;
}

interface PendingCheckpointRow {
  id: string;
  prompt: unknown;
  options: unknown;
  expiresAt: Date | string;
}

export class CheckpointPendingError extends Error {
  constructor(
    readonly runId: string,
    readonly checkpointId: string,
  ) {
    super(`Run ${runId} is waiting on checkpoint ${checkpointId}`);
    this.name = "CheckpointPendingError";
  }
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function checkpointUuid(parts: readonly string[]): string {
  const hex = createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}

export interface RunStoreOptions {
  readonly runId: string;
  readonly row: RunRow;
  readonly database?: Database;
  readonly now: () => string;
  readonly autoApproveSandboxCheckpoints: boolean;
}

export class PostgresRunStore {
  readonly #runId: string;
  readonly #row: RunRow;
  readonly #database?: Database;
  readonly #now: () => string;
  readonly #autoApproveSandboxCheckpoints: boolean;

  constructor(options: RunStoreOptions) {
    this.#runId = options.runId;
    this.#row = options.row;
    this.#database = options.database;
    this.#now = options.now;
    this.#autoApproveSandboxCheckpoints = options.autoApproveSandboxCheckpoints;
  }

  async #db(): Promise<Database> {
    return this.#database ?? getDb();
  }

  async append(eventInput: RunEventValue, actor: EventActor): Promise<number> {
    const event = RunEvent.parse(eventInput);
    const db = await this.#db();
    return asServiceRole(db, (tx) => this.#appendTx(tx, event, actor, this.#now()));
  }

  async #appendTx(
    tx: Database,
    event: RunEventValue,
    actor: EventActor,
    createdAt: string,
  ): Promise<number> {
    const rows = rowsOf<{ seq: number | string | bigint }>(
      await tx.execute(sql`
        INSERT INTO run_events (run_id, type, payload, actor, created_at)
        VALUES (${this.#runId}, ${event.type}, ${JSON.stringify(event)}::jsonb, ${actor}, ${createdAt})
        RETURNING seq
      `),
    );
    const seq = Number(rows[0]?.seq);
    if (!Number.isSafeInteger(seq)) throw new Error(`Appending ${event.type} returned an invalid sequence`);
    await projectRunEvent(tx, this.#runId, event, createdAt);
    return seq;
  }

  async loadState(): Promise<RunState> {
    const db = await this.#db();
    const eventRows = await asServiceRole(db, async (tx) =>
      rowsOf<EventRow>(
        await tx.execute(sql`
          SELECT id, run_id AS "runId", seq, actor, payload, created_at AS "createdAt"
          FROM run_events WHERE run_id = ${this.#runId} ORDER BY seq ASC
        `),
      ),
    );
    const records = eventRows.map((event) =>
      RunEventRecord.parse({
        id: event.id,
        runId: event.runId,
        seq: Number(event.seq),
        actor: event.actor,
        payload: event.payload,
        createdAt: iso(event.createdAt),
      }),
    );
    const folded = fold(
      { runId: this.#runId as never, ventureId: this.#row.ventureId as never },
      records,
    );
    if (records.length > 0) {
      return {
        ...folded,
        seed: folded.seed || this.#row.seed,
        playbookId: folded.playbookId || this.#row.playbookId,
        playbookVersion: folded.playbookVersion || this.#row.playbookVersion,
      };
    }
    return {
      ...folded,
      autonomy: this.#row.autonomy,
      seed: this.#row.seed,
      playbookId: this.#row.playbookId,
      playbookVersion: this.#row.playbookVersion,
    };
  }

  async pendingCheckpointId(): Promise<string | undefined> {
    const db = await this.#db();
    return asServiceRole(db, async (tx) => {
      const pending = rowsOf<PendingCheckpointRow>(await tx.execute(sql`
        SELECT id, prompt, options, expires_at AS "expiresAt"
        FROM checkpoints WHERE run_id = ${this.#runId} AND status = 'pending'
        ORDER BY created_at ASC LIMIT 1
      `))[0];
      if (!pending) return undefined;
      const prompt = z.object({ notBefore: z.string().datetime().optional() }).passthrough().safeParse(pending.prompt);
      const expiredVeto = this.#row.autonomy === "autonomous" && prompt.success && prompt.data.notBefore
        && new Date(prompt.data.notBefore).getTime() <= new Date(this.#now()).getTime();
      if (!expiredVeto) return pending.id;

      const options = z.array(z.object({ id: z.string(), recommended: z.boolean().optional() })).safeParse(pending.options);
      const selected = options.success
        ? options.data.find((option) => option.recommended) ?? options.data[0]
        : undefined;
      if (!selected) throw new Error(`Autonomous checkpoint ${pending.id} has no proceed option`);
      const decidedAt = this.#now();
      await tx.execute(sql`
        UPDATE checkpoints SET status = 'auto',
          decision = ${JSON.stringify({ optionId: selected.id, note: "veto window elapsed" })}::jsonb,
          decided_at = ${decidedAt}
        WHERE id = ${pending.id} AND status = 'pending'
      `);
      await this.#appendTx(
        tx,
        RunEvent.parse({ type: "checkpoint.decided", checkpointId: pending.id, status: "auto", optionId: selected.id }),
        "system",
        decidedAt,
      );
      return rowsOf<{ id: string }>(await tx.execute(sql`
        SELECT id FROM checkpoints WHERE run_id = ${this.#runId} AND status = 'pending'
        ORDER BY created_at ASC LIMIT 1
      `))[0]?.id;
    });
  }

  async writeArtifact(args: Parameters<OrchestratorDeps["writeArtifact"]>[0]): Promise<string> {
    const type = ArtifactType.parse(args.type);
    const quality = ArtifactQuality.parse(args.quality);
    if (!/^[a-f0-9]{64}$/i.test(args.contentHash)) throw new Error("Artifact content hash must be sha256 hex");
    parseArtifactContent(type, args.content);
    const db = await this.#db();
    return asServiceRole(db, async (tx) => {
      await tx.execute(sql`SELECT id FROM runs WHERE id = ${this.#runId} FOR UPDATE`);
      const exact = rowsOf<{ id: string }>(
        await tx.execute(sql`
          SELECT id FROM artifacts
          WHERE run_id = ${this.#runId} AND type = ${type} AND content_hash = ${args.contentHash}
          ORDER BY version DESC LIMIT 1
        `),
      )[0];
      if (exact) return exact.id;

      const previous = rowsOf<ExistingArtifactRow>(
        await tx.execute(sql`
          SELECT id, version FROM artifacts WHERE run_id = ${this.#runId} AND type = ${type}
          ORDER BY version DESC LIMIT 1
        `),
      )[0];
      const id = randomUUID();
      const version = Number(previous?.version ?? 0) + 1;
      await tx.execute(sql`
        INSERT INTO artifacts
          (id, venture_id, run_id, type, version, parent_id, status, content,
           content_hash, quality, created_by_task_id)
        VALUES (${id}, ${this.#row.ventureId}, ${this.#runId}, ${type}, ${version},
          ${previous?.id ?? null}, 'accepted', ${JSON.stringify(args.content)}::jsonb,
          ${args.contentHash}, ${JSON.stringify(quality)}::jsonb, ${args.taskId})
      `);
      return id;
    });
  }

  async requestCheckpoint(
    args: Parameters<OrchestratorDeps["requestCheckpoint"]>[0],
  ): Promise<{ optionId: string; approved: boolean }> {
    const kind = CheckpointKind.parse(args.kind);
    const checkpointId = checkpointUuid([this.#runId, "checkpoint", kind, args.title]);
    const auto = this.#row.sandbox && this.#autoApproveSandboxCheckpoints;
    const db = await this.#db();
    const outcome = await asServiceRole(db, async (tx) => {
      let existing = rowsOf<CheckpointRow>(
        await tx.execute(sql`
          SELECT id, status::text AS status, decision FROM checkpoints
          WHERE run_id = ${this.#runId} AND kind = ${kind} AND title = ${args.title}
          ORDER BY created_at DESC LIMIT 1
        `),
      )[0];
      if (!existing) {
        const createdAt = this.#now();
        const expiresAt = new Date(
          new Date(createdAt).getTime() + (args.vetoWindowMs ?? 72 * 60 * 60 * 1_000),
        ).toISOString();
        const inserted = rowsOf<{ id: string }>(await tx.execute(sql`
          INSERT INTO checkpoints
            (id, run_id, kind, title, prompt, options, status, expires_at, created_at)
          VALUES (${checkpointId}, ${this.#runId}, ${kind}, ${args.title},
            ${JSON.stringify({
              question: args.question,
              context: args.context,
              artifactIds: [],
              ...(args.vetoWindowMs ? { notBefore: expiresAt } : {}),
            })}::jsonb,
            ${JSON.stringify(args.options)}::jsonb, 'pending', ${expiresAt}, ${createdAt})
          ON CONFLICT (id) DO NOTHING
          RETURNING id
        `));
        if (inserted.length === 1) {
          await this.#appendTx(
            tx,
            RunEvent.parse({ type: "checkpoint.requested", checkpointId, kind, title: args.title }),
            "system",
            createdAt,
          );
          if (args.vetoWindowMs && !this.#row.sandbox) {
            await tx.execute(sql`
              INSERT INTO job_queue (name, payload, idempotency_key, max_attempts, run_after)
              VALUES ('run.execute',
                ${JSON.stringify({ runId: this.#runId, autoApproveSandboxCheckpoints: false })}::jsonb,
                ${`run:${this.#runId}:veto:${checkpointId}`}, 3, ${expiresAt})
              ON CONFLICT (name, idempotency_key) DO NOTHING
            `);
          }
        }
        existing = { id: checkpointId, status: "pending", decision: null };
      }

      const decision = z.object({ optionId: z.string() }).safeParse(existing.decision);
      if (existing.status !== "pending") {
        return {
          kind: "decision" as const,
          optionId: decision.success ? decision.data.optionId : (args.options[0]?.id ?? "unknown"),
          approved: existing.status === "approved" || existing.status === "auto",
        };
      }
      if (!auto) return { kind: "pending" as const, checkpointId: existing.id };

      const selected = args.options.find((option) => option.recommended) ?? args.options[0];
      if (!selected) throw new Error(`Checkpoint ${args.title} has no options`);
      const decidedAt = this.#now();
      await tx.execute(sql`
        UPDATE checkpoints SET status = 'auto',
          decision = ${JSON.stringify({ optionId: selected.id, note: "sandbox auto-decision" })}::jsonb,
          decided_at = ${decidedAt}
        WHERE id = ${existing.id} AND status = 'pending'
      `);
      await this.#appendTx(
        tx,
        RunEvent.parse({
          type: "checkpoint.decided",
          checkpointId: existing.id,
          status: "auto",
          optionId: selected.id,
        }),
        "system",
        decidedAt,
      );
      return { kind: "decision" as const, optionId: selected.id, approved: true };
    });

    if (outcome.kind === "pending") {
      throw new CheckpointPendingError(this.#runId, outcome.checkpointId);
    }
    return { optionId: outcome.optionId, approved: outcome.approved };
  }
}
