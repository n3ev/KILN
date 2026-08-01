import { z } from "zod";
import { MetricKey } from "./metrics.js";
import { Micros, Timestamp, VentureId } from "./primitives.js";

/**
 * Operator agent output — the post-launch daily loop that justifies a weekly
 * price. Every digest is required to carry the raw numbers that produced it, so
 * the customer never reads an interpretation they cannot check.
 */

export const MetricReading = z.object({
  key: MetricKey,
  value: z.number(),
  previousValue: z.number().optional(),
  deltaPct: z.number().optional(),
  /** Honest staleness — the dashboard says "4 hours ago", never pretends. */
  asOf: Timestamp,
  provider: z.string().min(1),
});

export const Anomaly = z.object({
  metric: MetricKey,
  kind: z.enum(["spike", "drop", "flatline", "threshold-breach", "data-gap"]),
  severity: z.enum(["info", "warning", "critical"]),
  observed: z.number(),
  expected: z.number().optional(),
  window: z.string().min(1),
  interpretation: z.string().min(1),
});

export const ActionKind = z.enum([
  "price-change",
  "pause-product",
  "restock",
  "creative-refresh",
  "budget-shift",
  "copy-edit",
  "email-send",
  "shipping-change",
  "investigate",
  "no-action",
]);

export const ActionProposal = z.object({
  id: z.string().min(1),
  kind: ActionKind,
  title: z.string().min(1),
  reasoning: z.string().min(1),
  /** The metric this is expected to move, and by roughly how much. */
  expectedEffect: z.object({ metric: MetricKey, direction: z.enum(["up", "down"]), magnitude: z.string().min(1) }),
  /** Concrete tool calls, so approval means execution, not a to-do item. */
  toolCalls: z.array(z.object({ toolId: z.string().min(1), input: z.record(z.string(), z.unknown()) })).default([]),
  estimatedCostMicros: Micros.default(0),
  reversible: z.boolean(),
  /** Blocking approval unless autonomy and standing authorisation cover it. */
  requiresApproval: z.boolean(),
  confidence: z.number().min(0).max(1),
  expiresAt: Timestamp.optional(),
});
export type ActionProposal = z.infer<typeof ActionProposal>;

export const OperatingDigest = z.object({
  ventureId: VentureId,
  period: z.object({ from: Timestamp, to: Timestamp }),
  /** Exactly three sentences of plain language. Enforced by the rubric. */
  narrative: z.string().min(1),
  /** The numbers behind the narrative. Required — never interpretation alone. */
  readings: z.array(MetricReading).min(1),
  anomalies: z.array(Anomaly).default([]),
  proposals: z.array(ActionProposal).default([]),
  /** Health of the data itself. A stale sync degrades the digest honestly. */
  dataHealth: z.object({
    complete: z.boolean(),
    staleProviders: z.array(z.string()).default([]),
    oldestSyncAt: Timestamp.optional(),
    caveat: z.string().optional(),
  }),
  generatedAt: Timestamp,
});
export type OperatingDigest = z.infer<typeof OperatingDigest>;
