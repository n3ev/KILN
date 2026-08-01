import { z } from "zod";
import { Timestamp } from "./primitives.js";

/**
 * Critic output — CLAUDE.md §3.2.
 *
 * The Critic rejects and instructs; it never rewrites. That separation is the
 * whole mechanism: a model that edits its own draft regresses toward the mean,
 * and the mean is slop. So this schema has no field capable of holding
 * replacement prose for the whole artifact — only pointed, local diffs the
 * *generating* agent must act on itself.
 */

export const RubricAxis = z.enum([
  "specificity",
  "evidence",
  "voiceFidelity",
  "differentiation",
  "commercialSharpness",
  "visualCraft",
]);
export type RubricAxis = z.infer<typeof RubricAxis>;

export const AXIS_DEFINITIONS: Readonly<Record<RubricAxis, string>> = {
  specificity:
    "Names concrete people, numbers, places, and mechanisms. A sentence that would be true of any business in the category scores 0.",
  evidence:
    "Quantitative and market claims carry a source or an explicit assumption marker with confidence. Unsourced figures score 0.",
  voiceFidelity:
    "Reads as the brand's voice charter, not as a competent generic writer. Check against writes/neverWrites.",
  differentiation:
    "Commits to a position a competitor could not copy-paste. Hedged both-ways statements score low.",
  commercialSharpness:
    "Moves a buyer toward a decision. Answers a real objection, names a price, or removes a risk.",
  visualCraft:
    "For visual artifacts: typographic hierarchy, spacing rhythm, colour discipline, and image coherence.",
};

/** 0–5. Anything below 4 on any applicable axis rejects the artifact. */
export const AxisScore = z.object({
  axis: RubricAxis,
  score: z.number().int().min(0).max(5),
  /** Required whenever the score is below 5 — a bare number is not feedback. */
  justification: z.string().min(1),
});

/**
 * A pointed, local instruction. `replaceWith` is intentionally capped short:
 * the Critic may show what a fix looks like at the sentence level, but it
 * cannot ghost-write the artifact.
 */
export const CritiqueDiff = z.object({
  axis: RubricAxis,
  /** Where the problem is — a quote from the artifact, not a paraphrase. */
  locate: z.string().min(1),
  problem: z.string().min(1),
  instruction: z.string().min(1),
  replaceWith: z.string().max(240).optional(),
  severity: z.enum(["must-fix", "should-fix"]),
});
export type CritiqueDiff = z.infer<typeof CritiqueDiff>;

export const PASS_THRESHOLD = 4;

export const CritiqueVerdict = z.object({
  artifactType: z.string().min(1),
  artifactVersion: z.number().int().positive(),
  rubricId: z.string().min(1),
  /** Only the axes that apply to this artifact type are scored. */
  scores: z.array(AxisScore).min(1),
  passed: z.boolean(),
  diffs: z.array(CritiqueDiff).default([]),
  /** Which repair cycle produced this verdict. Three rejections escalate. */
  cycle: z.number().int().min(0).max(3),
  /** One paragraph the customer could read. Blunt, not cruel. */
  summary: z.string().min(1),
  critiquedAt: Timestamp,
}).refine(
  (v) => v.passed === v.scores.every((s) => s.score >= PASS_THRESHOLD),
  { message: "passed must equal (every axis >= 4)", path: ["passed"] },
).refine((v) => v.passed || v.diffs.some((d) => d.severity === "must-fix"), {
  message: "a rejection must carry at least one must-fix diff",
  path: ["diffs"],
});
export type CritiqueVerdict = z.infer<typeof CritiqueVerdict>;

export function weakestAxis(v: CritiqueVerdict): RubricAxis | undefined {
  const sorted = [...v.scores].sort((a, b) => a.score - b.score);
  return sorted[0]?.axis;
}
