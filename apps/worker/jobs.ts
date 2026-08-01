import {
  ConnectorProvider,
  EscrowScheduleRequest,
  RotationRequest,
  type EscrowScheduleReceipt,
} from "@kiln/connectors";
import { StripeJobPayload } from "@kiln/billing";
import type { DurableJob, JobHandler, JobQueue } from "@kiln/jobs";
import type { MirrorWriteResult, ReconcileOptions } from "@kiln/mirror";
import { logger, type Logger } from "@kiln/observability";
import { z } from "zod";

export const JOB_NAMES = {
  runExecute: "run.execute",
  mirrorReconcile: "mirror.reconcile",
  credentialRotate: "credential.rotate",
  escrowSchedule: "escrow.schedule",
  billingStripeEvent: "billing.stripe-event",
} as const;

export const RunExecutePayload = z.object({
  runId: z.string().uuid(),
  /** Only honoured when the persisted run is sandboxed. */
  autoApproveSandboxCheckpoints: z.boolean().default(true),
});
export type RunExecutePayload = z.input<typeof RunExecutePayload>;
export type ParsedRunExecutePayload = z.infer<typeof RunExecutePayload>;

export const MirrorReconcilePayload = z.object({
  connectionId: z.string().uuid(),
  windowDays: z.number().int().min(1).max(31).default(7),
  windowEnd: z.string().datetime().optional(),
});
export type MirrorReconcilePayload = z.input<typeof MirrorReconcilePayload>;

export const CredentialRotatePayload = RotationRequest;
export type CredentialRotatePayload = z.infer<typeof CredentialRotatePayload>;

export const EscrowSchedulePayload = EscrowScheduleRequest;
export type EscrowSchedulePayload = z.infer<typeof EscrowSchedulePayload>;

export interface RunExecutionResult {
  readonly runId: string;
  readonly status: "succeeded" | "already-terminal" | "paused" | "waiting-on-checkpoint";
  readonly artifacts: number;
}

export interface RunExecutionService {
  execute(payload: ParsedRunExecutePayload): Promise<RunExecutionResult>;
}

export interface MirrorReconciliationService {
  reconcile(payload: ReconcileOptions): Promise<MirrorWriteResult>;
}

export interface CredentialRotationService {
  rotate(payload: CredentialRotatePayload): Promise<{ rotated: boolean; reason?: string }>;
}

export interface EscrowSchedulingService {
  schedule(payload: EscrowSchedulePayload): Promise<EscrowScheduleReceipt>;
}

export interface BillingEventService {
  process(eventId: string): Promise<boolean>;
}

export interface JobServices {
  readonly run: RunExecutionService;
  readonly mirror: MirrorReconciliationService;
  readonly rotation: CredentialRotationService;
  readonly escrow: EscrowSchedulingService;
  readonly billing: BillingEventService;
}

export interface CreateJobHandlersOptions {
  readonly queue: JobQueue;
  readonly services: JobServices;
  readonly heartbeatMs?: number;
  readonly log?: Logger;
}

async function heartbeatWhile<T>(
  queue: JobQueue,
  job: DurableJob,
  milliseconds: number,
  log: Logger,
  work: () => Promise<T>,
): Promise<T> {
  const timer = setInterval(() => {
    void queue
      .heartbeat(job.id)
      .then((owned) => {
        if (!owned) log.warn("job heartbeat lost its lock", { jobId: job.id, jobName: job.name });
      })
      .catch((error: unknown) => {
        log.warn("job heartbeat failed", {
          jobId: job.id,
          jobName: job.name,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, milliseconds);
  timer.unref();
  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
}

/** Typed registry for every prompt-1 worker job. */
export function createJobHandlers(options: CreateJobHandlersOptions): Record<string, JobHandler> {
  const heartbeatMs = options.heartbeatMs ?? 30_000;
  if (!Number.isInteger(heartbeatMs) || heartbeatMs < 1) {
    throw new Error("heartbeatMs must be a positive integer");
  }
  const log = options.log ?? logger;
  const wrap = (handler: JobHandler): JobHandler => (job) =>
    heartbeatWhile(options.queue, job, heartbeatMs, log, () => handler(job));

  return {
    [JOB_NAMES.runExecute]: wrap(async (job) => {
      const payload = RunExecutePayload.parse(job.payload);
      const result = await options.services.run.execute(payload);
      log.info("run execution job handled", { jobId: job.id, runId: payload.runId, status: result.status });
    }),
    [JOB_NAMES.mirrorReconcile]: wrap(async (job) => {
      const payload = MirrorReconcilePayload.parse(job.payload);
      const result = await options.services.mirror.reconcile(payload);
      log.info("mirror reconciliation job handled", {
        jobId: job.id,
        connectionId: payload.connectionId,
        snapshots: result.snapshots,
        orders: result.orders,
      });
    }),
    [JOB_NAMES.credentialRotate]: wrap(async (job) => {
      const payload = CredentialRotatePayload.parse(job.payload);
      const result = await options.services.rotation.rotate(payload);
      log.info("credential rotation job handled", {
        jobId: job.id,
        credentialId: payload.credentialId,
        provider: ConnectorProvider.parse(payload.provider),
        rotated: result.rotated,
        reason: result.reason,
      });
    }),
    [JOB_NAMES.escrowSchedule]: wrap(async (job) => {
      const payload = EscrowSchedulePayload.parse(job.payload);
      const result = await options.services.escrow.schedule(payload);
      log.info("escrow scheduling job handled", {
        jobId: job.id,
        ventureId: payload.ventureId,
        scheduleKey: result.scheduleKey,
        mode: result.mode,
      });
    }),
    [JOB_NAMES.billingStripeEvent]: wrap(async (job) => {
      const payload = StripeJobPayload.parse(job.payload);
      const processed = await options.services.billing.process(payload.eventId);
      log.info("Stripe billing event job handled", {
        jobId: job.id,
        eventId: payload.eventId,
        processed,
      });
    }),
  };
}
