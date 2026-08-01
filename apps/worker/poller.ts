import { workOnce, type JobHandler, type JobQueue } from "@kiln/jobs";
import { logger, type Logger } from "@kiln/observability";

export interface WorkerPollerOptions {
  readonly queue: JobQueue;
  readonly handlers: Readonly<Record<string, JobHandler>>;
  readonly signal: AbortSignal;
  readonly pollIntervalMs?: number;
  readonly log?: Logger;
  /** Test seam; production uses the abort-aware timer below. */
  readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

export function waitForPoll(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}

/**
 * Claims one durable job at a time. Shutdown stops new claims and lets the
 * active handler finish, so a SIGTERM cannot abandon work halfway through a
 * database transaction.
 */
export async function runPoller(options: WorkerPollerOptions): Promise<void> {
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 1) {
    throw new Error("pollIntervalMs must be a positive integer");
  }
  const log = options.log ?? logger;
  const wait = options.wait ?? waitForPoll;

  while (!options.signal.aborted) {
    let worked = false;
    try {
      worked = await workOnce(options.queue, options.handlers);
    } catch (error) {
      log.error("worker poll failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (!worked && !options.signal.aborted) {
      await wait(pollIntervalMs, options.signal);
    }
  }
}
