import { MetricSnapshot } from "@kiln/contracts";
import { z } from "zod";

/** Providers with a canonical mirror adapter in the KILN connector boundary. */
export const ConnectorProvider = z.enum([
  "shopify",
  "stripe",
  "analytics",
  "resend",
  "cal-com",
  "ads",
]);
export type ConnectorProvider = z.infer<typeof ConnectorProvider>;

export const ConnectorMode = z.enum(["mock", "live"]);
export type ConnectorMode = z.infer<typeof ConnectorMode>;

export const RotationPolicy = z.enum(["supported", "reissue-only", "manual"]);
export type RotationPolicy = z.infer<typeof RotationPolicy>;

export const ReconciliationRequest = z
  .object({
    ventureId: z.string().uuid(),
    connectionId: z.string().uuid(),
    provider: ConnectorProvider,
    windowStart: z.string().datetime(),
    windowEnd: z.string().datetime(),
    cursor: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((request, ctx) => {
    const start = new Date(request.windowStart).getTime();
    const end = new Date(request.windowEnd).getTime();
    if (end <= start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["windowEnd"],
        message: "windowEnd must be later than windowStart",
      });
    }
    if (end - start > 31 * 24 * 60 * 60 * 1_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["windowStart"],
        message: "a reconciliation window may not exceed 31 days",
      });
    }
  });
export type ReconciliationRequest = z.infer<typeof ReconciliationRequest>;

/** Canonical order shape. Customer PII is deliberately absent. */
export const MirroredOrder = z.object({
  ventureId: z.string().uuid(),
  provider: ConnectorProvider,
  externalId: z.string().min(1),
  placedAt: z.string().datetime(),
  grossCents: z.number().int().nonnegative(),
  netCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  items: z.array(
    z.object({
      sku: z.string().min(1),
      quantity: z.number().int().positive(),
      grossCents: z.number().int().nonnegative(),
    }),
  ),
  customerRef: z.string().min(1).optional(),
  status: z.enum(["paid", "partially_refunded", "refunded", "cancelled"]),
});
export type MirroredOrder = z.infer<typeof MirroredOrder>;

export const ReconciliationBatch = z.object({
  provider: ConnectorProvider,
  mode: ConnectorMode,
  snapshots: z.array(MetricSnapshot),
  orders: z.array(MirroredOrder),
  nextCursor: z.record(z.string(), z.unknown()),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
});
export type ReconciliationBatch = z.infer<typeof ReconciliationBatch>;

export interface Connector {
  readonly provider: ConnectorProvider;
  readonly mode: ConnectorMode;
  readonly rotation: RotationPolicy;
  reconcile(request: ReconciliationRequest): Promise<ReconciliationBatch>;
  issueRotationCredential(request: RotationRequest): Promise<string>;
  verifyRotationCredential(secret: string, request: RotationRequest): Promise<boolean>;
}

export const RotationRequest = z.object({
  credentialId: z.string().uuid(),
  accountId: z.string().uuid(),
  provider: ConnectorProvider,
});
export type RotationRequest = z.infer<typeof RotationRequest>;

export const EscrowScheduleRequest = z.object({
  ventureId: z.string().uuid(),
  accountId: z.string().uuid(),
  recipientPublicKey: z.string().min(16),
  scheduledFor: z.string().datetime(),
});
export type EscrowScheduleRequest = z.infer<typeof EscrowScheduleRequest>;

export const EscrowScheduleReceipt = z.object({
  scheduleKey: z.string().length(64),
  mode: ConnectorMode,
  ventureId: z.string().uuid(),
  scheduledFor: z.string().datetime(),
  status: z.enum(["scheduled", "stubbed"]),
});
export type EscrowScheduleReceipt = z.infer<typeof EscrowScheduleReceipt>;

export interface EscrowScheduler {
  readonly mode: ConnectorMode;
  schedule(request: EscrowScheduleRequest): Promise<EscrowScheduleReceipt>;
}
