import { randomUUID } from "node:crypto";
import type { DurableJob, EnqueueOptions, JobQueue } from "./index.js";

export interface MemoryJobQueueOptions {
  readonly now?: () => Date;
  readonly baseRetryMs?: number;
}

/** Deterministic test/demo adapter with the same retry and idempotency contract. */
export class MemoryJobQueue implements JobQueue {
  readonly #jobs = new Map<string, DurableJob>();
  readonly #now: () => Date;
  readonly #baseRetryMs: number;

  constructor(options: MemoryJobQueueOptions = {}) {
    this.#now = options.now ?? (() => new Date());
    this.#baseRetryMs = options.baseRetryMs ?? 1_000;
  }

  async enqueue(name: string, payload: unknown, options: EnqueueOptions = {}): Promise<string> {
    if (options.idempotencyKey) {
      const existing = [...this.#jobs.values()].find(
        (job) => job.name === name && job.idempotencyKey === options.idempotencyKey,
      );
      if (existing) return existing.id;
    }
    const now = this.#now();
    const job: DurableJob = {
      id: randomUUID(),
      name,
      payload,
      idempotencyKey: options.idempotencyKey ?? null,
      status: "pending",
      attempts: 0,
      maxAttempts: options.maxAttempts ?? 3,
      runAfter: options.runAfter ?? now,
      lockedAt: null,
      lockedBy: null,
      lastError: null,
      completedAt: null,
      createdAt: now,
    };
    this.#jobs.set(job.id, job);
    return job.id;
  }

  async claim(): Promise<DurableJob | undefined> {
    const now = this.#now();
    const job = [...this.#jobs.values()]
      .filter((candidate) => candidate.status === "pending" && candidate.runAfter <= now)
      .sort((left, right) => left.runAfter.getTime() - right.runAfter.getTime())[0];
    if (!job) return undefined;
    const claimed = { ...job, status: "running" as const, attempts: job.attempts + 1, lockedAt: now, lockedBy: "memory" };
    this.#jobs.set(job.id, claimed);
    return structuredClone(claimed);
  }

  async complete(jobId: string): Promise<boolean> {
    const job = this.#jobs.get(jobId);
    if (!job || job.status !== "running") return false;
    this.#jobs.set(jobId, { ...job, status: "completed", completedAt: this.#now(), lockedAt: null, lockedBy: null });
    return true;
  }

  async fail(jobId: string, error: unknown): Promise<"pending" | "failed" | "lost"> {
    const job = this.#jobs.get(jobId);
    if (!job || job.status !== "running") return "lost";
    const failed = job.attempts >= job.maxAttempts;
    const status = failed ? "failed" : "pending";
    this.#jobs.set(jobId, {
      ...job,
      status,
      lastError: error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) },
      runAfter: failed
        ? job.runAfter
        : new Date(this.#now().getTime() + this.#baseRetryMs * 2 ** Math.max(0, job.attempts - 1)),
      lockedAt: null,
      lockedBy: null,
    });
    return status;
  }

  async heartbeat(jobId: string): Promise<boolean> {
    const job = this.#jobs.get(jobId);
    if (!job || job.status !== "running") return false;
    this.#jobs.set(jobId, { ...job, lockedAt: this.#now() });
    return true;
  }

  get(jobId: string): DurableJob | undefined {
    const job = this.#jobs.get(jobId);
    return job ? structuredClone(job) : undefined;
  }
}

