import { z } from "zod";
import { Timestamp } from "./primitives.js";

/**
 * Quality gates — the deterministic pre-launch checks of CLAUDE.md §11.5.
 *
 * Distinct from a hard gate (runtime, human approval) and from the Critic
 * (model judgement). A quality gate is a plain function over the artifact set
 * and the deployed site. It is never overridable by an agent, and a human can
 * only clear it through a `quality_override` checkpoint that stamps the
 * artifact and surfaces in the handover packet.
 */

export const QualityGateId = z.enum([
  "product-descriptions",
  "product-imagery",
  "no-broken-links",
  "no-placeholders",
  "lighthouse",
  "checkout-transacts",
  "policies-present",
  "email-authentication",
  "analytics-purchase-event",
  "compliance-clear",
  "positive-contribution-margin",
]);
export type QualityGateId = z.infer<typeof QualityGateId>;

export const GateAssertion = z.object({
  /** The exact assertion, quoted back verbatim when it fails. */
  assertion: z.string().min(1),
  passed: z.boolean(),
  /** What was actually observed. "3 of 7 products have 2 images." */
  observed: z.string().min(1),
  /** Where to look. A path, a URL, an artifact id. */
  locus: z.string().optional(),
});
export type GateAssertion = z.infer<typeof GateAssertion>;

export const QualityGateResult = z.object({
  gate: QualityGateId,
  passed: z.boolean(),
  assertions: z.array(GateAssertion).min(1),
  /** Set only via an explicit human override checkpoint. */
  overridden: z.boolean().default(false),
  overrideReason: z.string().optional(),
  overriddenByUserId: z.string().optional(),
  evaluatedAt: Timestamp,
}).refine((r) => !r.overridden || (r.overrideReason !== undefined && r.overriddenByUserId !== undefined), {
  message: "an override must record who did it and why",
  path: ["overrideReason"],
});
export type QualityGateResult = z.infer<typeof QualityGateResult>;

export const QualityReport = z.object({
  results: z.array(QualityGateResult).min(1),
  /** True only when every gate passed or was explicitly overridden. */
  clearedForLaunch: z.boolean(),
  /** Surfaced in the UI and the handover packet whenever anything was forced. */
  hasOverrides: z.boolean(),
  evaluatedAt: Timestamp,
});
export type QualityReport = z.infer<typeof QualityReport>;

/** Per-artifact quality metadata, stored on the artifact row. */
export const ArtifactQuality = z.object({
  /** Set when the model gateway fell back to a degraded provider. */
  degraded: z.boolean().default(false),
  /** Set when a human overrode a failing quality gate for this artifact. */
  overridden: z.boolean().default(false),
  criticScore: z.number().min(0).max(5).optional(),
  criticCycles: z.number().int().min(0).max(3).default(0),
  lintPassed: z.boolean().optional(),
  notes: z.array(z.string()).default([]),
});
export type ArtifactQuality = z.infer<typeof ArtifactQuality>;

export function summarise(results: readonly QualityGateResult[]): QualityReport {
  const cleared = results.every((r) => r.passed || r.overridden);
  return {
    results: [...results] as QualityGateResult[],
    clearedForLaunch: cleared,
    hasOverrides: results.some((r) => r.overridden),
    evaluatedAt: new Date().toISOString(),
  };
}

export function failedAssertions(report: QualityReport): { gate: string; assertion: string; detail: string }[] {
  return report.results
    .filter((r) => !r.passed && !r.overridden)
    .flatMap((r) =>
      r.assertions
        .filter((a) => !a.passed)
        .map((a) => ({ gate: r.gate, assertion: a.assertion, detail: a.observed })),
    );
}
