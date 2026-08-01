import { randomUUID } from "node:crypto";
import { asServiceRole, getDb, rowsOf, type Database } from "@kiln/db";
import { sql } from "drizzle-orm";
import { z } from "zod";

export const JobStatus = z.enum(["pending", "running", "completed", "failed"]);
export type JobStatus = z.infer<typeof JobStatus>;

export const DurableJob = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  payload: z.unknown(),
  idempotencyKey: z.string().nullable(),
  status: JobStatus,
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  runAfter: z.coerce.date(),
  lockedAt: z.coerce.date().nullable(),
  lockedBy: z.string().nullable(),
  lastError: z.unknown().nullable(),
  completedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});
export type DurableJob = z.infer<typeof DurableJob>;

export interface EnqueueOptions {
  readonly idempotencyKey?: string;
  readonly maxAttempts?: number;
  readonly runAfter?: Date;
}

export interface JobQueue {
  enqueue(name: string, payload: unknown, options?: EnqueueOptions): Promise<string>;
  claim(): Promise<DurableJob | undefined>;
  complete(jobId: string): Promise<boolean>;
  fail(jobId: string, error: unknown): Promise<"pending" | "failed" | "lost">;
  heartbeat(jobId: string): Promise<boolean>;
}

interface JobRow {
  id: string;
  name: string;
  payload: unknown;
  idempotency_key: string | null;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  run_after: Date | string;
  locked_at: Date | string | null;
  locked_by: string | null;
  last_error: unknown | null;
  completed_at: Date | string | null;
  created_at: Date | string;
}

function mapRow(row: JobRow): DurableJob {
  return DurableJob.parse({
    id: row.id,
    name: row.name,
    payload: row.payload,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    runAfter: row.run_after,
    lockedAt: row.locked_at,
    lockedBy: row.locked_by,
    lastError: row.last_error,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  });
}

function serialiseError(error: unknown): string {
  const body =
    error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { name: "UnknownError", message: String(error) };
  return JSON.stringify(body);
}

export interface PostgresJobQueueOptions {
  readonly workerId?: string;
  readonly staleLockMs?: number;
  readonly baseRetryMs?: number;
  readonly database?: Database;
}

/** Durable `FOR UPDATE SKIP LOCKED` queue used when no hosted job adapter is configured. */
export class PostgresJobQueue implements JobQueue {
  readonly #workerId: string;
  readonly #staleLockMs: number;
  readonly #baseRetryMs: number;
  readonly #database?: Database;

  constructor(options: PostgresJobQueueOptions = {}) {
    this.#workerId = options.workerId ?? `worker-${randomUUID()}`;
    this.#staleLockMs = options.staleLockMs ?? 5 * 60_000;
    this.#baseRetryMs = options.baseRetryMs ?? 1_000;
    this.#database = options.database;
  }

  async #db(): Promise<Database> {
    return this.#database ?? getDb();
  }

  async enqueue(name: string, payload: unknown, options: EnqueueOptions = {}): Promise<string> {
    if (name.trim() === "") throw new Error("Job name must not be empty");
    const maxAttempts = options.maxAttempts ?? 3;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new Error("maxAttempts must be a positive integer");
    }
    const runAfter = options.runAfter ?? new Date();
    const payloadJson = JSON.stringify(payload ?? null);
    const db = await this.#db();

    return asServiceRole(db, async (tx) => {
      if (!options.idempotencyKey) {
        const rows = rowsOf<{ id: string }>(
          await tx.execute(sql`
            INSERT INTO job_queue (name, payload, max_attempts, run_after)
            VALUES (${name}, ${payloadJson}::jsonb, ${maxAttempts}, ${runAfter.toISOString()})
            RETURNING id
          `),
        );
        const id = rows[0]?.id;
        if (!id) throw new Error("Job enqueue returned no id");
        return id;
      }

      const rows = rowsOf<{ id: string }>(
        await tx.execute(sql`
          WITH inserted AS (
            INSERT INTO job_queue (name, payload, idempotency_key, max_attempts, run_after)
            VALUES (${name}, ${payloadJson}::jsonb, ${options.idempotencyKey}, ${maxAttempts}, ${runAfter.toISOString()})
            ON CONFLICT (name, idempotency_key) DO NOTHING
            RETURNING id
          )
          SELECT id FROM inserted
          UNION ALL
          SELECT id FROM job_queue
          WHERE name = ${name} AND idempotency_key = ${options.idempotencyKey}
          LIMIT 1
        `),
      );
      const id = rows[0]?.id;
      if (!id) throw new Error("Idempotent job enqueue returned no id");
      return id;
    });
  }

  async claim(): Promise<DurableJob | undefined> {
    const db = await this.#db();
    const rows = await asServiceRole(db, async (tx) =>
      rowsOf<JobRow>(
        await tx.execute(sql`
          WITH next_job AS (
            SELECT id
            FROM job_queue
            WHERE
              (status = 'pending' AND run_after <= now())
              OR (status = 'running' AND locked_at < now() - (${this.#staleLockMs} * interval '1 millisecond'))
            ORDER BY run_after ASC, created_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
          )
          UPDATE job_queue AS job
          SET status = 'running',
              attempts = job.attempts + 1,
              locked_at = now(),
              locked_by = ${this.#workerId}
          FROM next_job
          WHERE job.id = next_job.id
          RETURNING job.*
        `),
      ),
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  }

  async complete(jobId: string): Promise<boolean> {
    const db = await this.#db();
    const rows = await asServiceRole(db, async (tx) =>
      rowsOf<{ id: string }>(
        await tx.execute(sql`
          UPDATE job_queue
          SET status = 'completed', completed_at = now(), locked_at = NULL, locked_by = NULL
          WHERE id = ${jobId} AND status = 'running' AND locked_by = ${this.#workerId}
          RETURNING id
        `),
      ),
    );
    return rows.length === 1;
  }

  async fail(jobId: string, error: unknown): Promise<"pending" | "failed" | "lost"> {
    const db = await this.#db();
    const rows = await asServiceRole(db, async (tx) =>
      rowsOf<{ status: "pending" | "failed" }>(
        await tx.execute(sql`
          UPDATE job_queue
          SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
              run_after = CASE
                WHEN attempts >= max_attempts THEN run_after
                ELSE now() + (${this.#baseRetryMs} * power(2, greatest(attempts - 1, 0)) * interval '1 millisecond')
              END,
              last_error = ${serialiseError(error)}::jsonb,
              locked_at = NULL,
              locked_by = NULL
          WHERE id = ${jobId} AND status = 'running' AND locked_by = ${this.#workerId}
          RETURNING status
        `),
      ),
    );
    return rows[0]?.status ?? "lost";
  }

  async heartbeat(jobId: string): Promise<boolean> {
    const db = await this.#db();
    const rows = await asServiceRole(db, async (tx) =>
      rowsOf<{ id: string }>(
        await tx.execute(sql`
          UPDATE job_queue SET locked_at = now()
          WHERE id = ${jobId} AND status = 'running' AND locked_by = ${this.#workerId}
          RETURNING id
        `),
      ),
    );
    return rows.length === 1;
  }
}

export type JobHandler = (job: DurableJob) => Promise<void>;

/** Claims and handles at most one job. Returning false is the worker's idle signal. */
export async function workOnce(
  queue: JobQueue,
  handlers: Readonly<Record<string, JobHandler>>,
): Promise<boolean> {
  const job = await queue.claim();
  if (!job) return false;
  try {
    const handler = handlers[job.name];
    if (!handler) throw new Error(`No handler registered for job ${job.name}`);
    await handler(job);
    if (!(await queue.complete(job.id))) throw new Error(`Lost lock while completing job ${job.id}`);
  } catch (error) {
    await queue.fail(job.id, error);
  }
  return true;
}

export { MemoryJobQueue } from "./memory.js";
export type { MemoryJobQueueOptions } from "./memory.js";
