import { z } from "zod";
import { Confidence, Currency, Micros, Timestamp } from "./primitives.js";
import { SourceRef, sourced } from "./sources.js";

/**
 * Analyst outputs. The Analyst is explicitly empowered to recommend killing
 * the idea, and the schema makes `kill` a first-class verdict rather than a
 * sad footnote — a validation step that cannot say no is theatre, and the
 * customer paid for a real answer.
 */

export const DemandSignal = z.object({
  channel: z.enum(["search", "marketplace", "social", "community", "retail", "directory"]),
  label: z.string().min(1),
  /** Monthly volume, absolute. Sourced — never a vibe. */
  monthlyVolume: sourced(z.number().nonnegative()),
  trend: z.enum(["rising", "flat", "declining", "seasonal", "unknown"]),
  competitionLevel: z.enum(["low", "moderate", "high", "saturated"]),
  interpretation: z.string().min(1),
});

export const Competitor = z.object({
  name: z.string().min(1),
  url: z.string().url().optional(),
  positioning: z.string().min(1),
  priceRange: z
    .object({ lowMicros: Micros, highMicros: Micros, currency: Currency })
    .optional(),
  strengths: z.array(z.string().min(1)).min(1),
  weaknesses: z.array(z.string().min(1)).min(1),
  /**
   * Verbatim complaints mined from public reviews. The single highest-signal
   * input into positioning, so it is required rather than optional.
   */
  customerComplaints: z.array(
    z.object({
      quote: z.string().min(1),
      theme: z.string().min(1),
      source: SourceRef,
    }),
  ),
  estimatedScale: sourced(z.string().min(1)).optional(),
});

export const ChannelViability = z.object({
  channel: z.string().min(1),
  viability: z.enum(["primary", "secondary", "experimental", "unviable"]),
  estimatedCacMicros: sourced(Micros).optional(),
  timeToFirstCustomerDays: sourced(z.number().nonnegative()).optional(),
  requirements: z.array(z.string().min(1)).default([]),
  reasoning: z.string().min(1),
});

export const UnitEconomicsModel = z.object({
  currency: Currency,
  /** Per-unit at the modelled price point. */
  priceMicros: Micros,
  cogsMicros: Micros,
  fulfilmentMicros: Micros,
  paymentFeesMicros: Micros,
  variableAdSpendMicros: Micros,
  /** price − all variable costs. Negative is allowed and must be surfaced. */
  contributionMarginMicros: z.number().int(),
  contributionMarginPct: z.number(),
  fixedMonthlyMicros: Micros,
  breakevenUnitsPerMonth: z.number().nonnegative(),
  /** Units/month at which the founder's time clears their stated alternative. */
  worthwhileUnitsPerMonth: z.number().nonnegative().optional(),
  assumptions: z.array(SourceRef).min(1),
  sensitivity: z
    .array(
      z.object({
        variable: z.string().min(1),
        deltaPct: z.number(),
        contributionMarginMicros: z.number().int(),
      }),
    )
    .default([]),
});
export type UnitEconomicsModel = z.infer<typeof UnitEconomicsModel>;

export const Verdict = z.enum(["go", "reshape", "kill"]);
export type Verdict = z.infer<typeof Verdict>;

export const ValidationReport = z.object({
  verdict: Verdict,
  confidence: Confidence,
  /** Two or three sentences. The thing the customer reads first. */
  headline: z.string().min(1).max(600),

  demandSignals: z.array(DemandSignal).min(1),
  competitors: z.array(Competitor).min(1),
  channels: z.array(ChannelViability).min(1),
  economics: UnitEconomicsModel,

  /** Market size, only when it can be sourced. Refuses hand-waved TAM. */
  marketSize: sourced(z.object({ valueMicros: Micros, currency: Currency, basis: z.string() })).optional(),

  /** What would have to be true for this to work. Testable statements only. */
  criticalAssumptions: z.array(
    z.object({
      statement: z.string().min(1),
      confidence: Confidence,
      testableBy: z.string().min(1),
      ifFalse: z.string().min(1),
    }),
  ).min(1),

  risks: z.array(
    z.object({
      risk: z.string().min(1),
      likelihood: z.enum(["low", "medium", "high"]),
      impact: z.enum(["low", "medium", "high"]),
      mitigation: z.string().min(1),
    }),
  ).default([]),

  /** Populated when the verdict is `reshape` — the concrete alternative. */
  reshapeProposal: z
    .object({
      change: z.string().min(1),
      rationale: z.string().min(1),
      revisedOneLiner: z.string().min(1),
    })
    .optional(),

  /** Populated when the verdict is `kill`. Required — never kill without one. */
  killRationale: z
    .object({
      primaryReason: z.string().min(1),
      evidence: z.array(SourceRef).min(1),
      /** What the customer could do instead. A kill is still a service. */
      adjacentOpportunities: z.array(z.string().min(1)).default([]),
    })
    .optional(),

  generatedAt: Timestamp,
})
  .refine((r) => r.verdict !== "kill" || r.killRationale !== undefined, {
    message: "a kill verdict requires killRationale",
    path: ["killRationale"],
  })
  .refine((r) => r.verdict !== "reshape" || r.reshapeProposal !== undefined, {
    message: "a reshape verdict requires reshapeProposal",
    path: ["reshapeProposal"],
  });
export type ValidationReport = z.infer<typeof ValidationReport>;

/** Contribution margin must be positive to clear the pre-launch quality gate. */
export function hasPositiveContribution(m: UnitEconomicsModel): boolean {
  return m.contributionMarginMicros > 0;
}
