import { z } from "zod";
import { Confidence, Timestamp } from "./primitives.js";

/**
 * Specificity enforcement — CLAUDE.md §3.3.
 *
 * Every quantitative or market claim an agent makes must be attributable. The
 * type system is where we enforce that: a claim about the market is not a
 * `number`, it is a `Sourced<number>`, and the only way to construct one is to
 * supply at least one reference. An agent that wants to guess must say so out
 * loud by emitting an `assumption` source with a confidence, which the Critic
 * and the UI both surface differently from an evidenced claim.
 *
 * This removes most of what readers recognise as AI slop, because slop is
 * mostly confident unattributed quantities.
 */

export const DocumentSource = z.object({
  kind: z.literal("document"),
  url: z.string().url(),
  title: z.string().min(1),
  /** When the fetch happened — stale evidence is weak evidence. */
  fetchedAt: Timestamp,
  /** The specific span relied upon. Not the whole page. */
  excerpt: z.string().min(1).max(2000),
});

export const ToolSource = z.object({
  kind: z.literal("tool"),
  toolId: z.string().min(1),
  toolCallId: z.string().min(1),
  /** JSON path into the tool output that carries the value. */
  field: z.string().min(1),
});

export const AssumptionSource = z.object({
  kind: z.literal("assumption"),
  statement: z.string().min(1),
  confidence: Confidence,
  rationale: z.string().min(1),
  /** What would have to be true to verify it. Drives the research backlog. */
  verifiableBy: z.string().optional(),
});

export const CustomerSource = z.object({
  kind: z.literal("customer"),
  /** Something the customer asserted at intake. Trusted, but attributable. */
  statement: z.string().min(1),
});

export const SourceRef = z.discriminatedUnion("kind", [
  DocumentSource,
  ToolSource,
  AssumptionSource,
  CustomerSource,
]);
export type SourceRef = z.infer<typeof SourceRef>;

/**
 * Wraps a value with its evidence. Use for anything a sceptical customer would
 * reasonably ask "says who?" about.
 */
export const sourced = <T extends z.ZodTypeAny>(value: T) =>
  z.object({
    value,
    sources: z.array(SourceRef).min(1, "every sourced claim needs at least one reference"),
    /** Optional prose the UI shows on hover. */
    note: z.string().optional(),
  });

export type Sourced<T> = { value: T; sources: SourceRef[]; note?: string };

/** True when a claim rests only on assumptions — the UI marks these visibly. */
export function isAssumedOnly(claim: { sources: SourceRef[] }): boolean {
  return claim.sources.length > 0 && claim.sources.every((s) => s.kind === "assumption");
}

/** Lowest confidence across assumption sources; 1 when everything is evidenced. */
export function claimConfidence(claim: { sources: SourceRef[] }): number {
  const assumptions = claim.sources.filter((s) => s.kind === "assumption");
  if (assumptions.length === 0) return 1;
  return Math.min(...assumptions.map((a) => a.confidence));
}
