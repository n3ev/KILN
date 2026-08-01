import { z } from "zod";
import { BrandSystem } from "./brand.js";
import { VentureBrief } from "./brief.js";
import { ProductCatalogue } from "./catalogue.js";
import { ComplianceReport, PolicySet } from "./compliance.js";
import { ContentSet } from "./content.js";
import { CritiqueVerdict } from "./critique.js";
import { GrowthPlan } from "./growth.js";
import { HandoverPacket } from "./handover.js";
import { ActionProposal, OperatingDigest } from "./operate.js";
import { ArtifactId, RunId, TaskId, Timestamp, VentureId } from "./primitives.js";
import { ArtifactQuality, QualityReport } from "./quality.js";
import { SourceRef } from "./sources.js";
import { StorefrontBuild } from "./storefront.js";
import { StrategyMemo } from "./strategy.js";
import { FulfilmentTradeoff, SupplyPlan } from "./supply.js";
import { UnitEconomicsModel, ValidationReport } from "./validation.js";

/**
 * The artifact registry.
 *
 * Artifacts are content-addressed and immutable; a change produces a new
 * version rather than mutating a row. `ARTIFACT_SCHEMAS` is the one place that
 * maps a type to its contract, which is what lets the runtime validate any
 * artifact generically without a switch statement in five different files.
 */

export const ArtifactType = z.enum([
  "venture_brief",
  "validation_report",
  "unit_economics",
  "strategy_memo",
  "brand_system",
  "product_catalogue",
  "supply_plan",
  "fulfilment_tradeoff",
  "storefront_build",
  "content_set",
  "growth_plan",
  "compliance_report",
  "policy_set",
  "critique_verdict",
  "quality_report",
  "operating_digest",
  "action_proposal",
  "handover_packet",
  "run_memo",
]);
export type ArtifactType = z.infer<typeof ArtifactType>;

/** The rolling, agent-maintained run summary — CLAUDE.md §8.5. */
export const RunMemo = z.object({
  entries: z
    .array(
      z.object({
        phase: z.string().min(1),
        decision: z.string().min(1),
        rationale: z.string().min(1),
        at: Timestamp,
      }),
    )
    .default([]),
  /** Hard cap so context assembly stays predictable. */
  approxTokens: z.number().int().nonnegative().default(0),
});
export type RunMemo = z.infer<typeof RunMemo>;

export const ARTIFACT_SCHEMAS = {
  venture_brief: VentureBrief,
  validation_report: ValidationReport,
  unit_economics: UnitEconomicsModel,
  strategy_memo: StrategyMemo,
  brand_system: BrandSystem,
  product_catalogue: ProductCatalogue,
  supply_plan: SupplyPlan,
  fulfilment_tradeoff: FulfilmentTradeoff,
  storefront_build: StorefrontBuild,
  content_set: ContentSet,
  growth_plan: GrowthPlan,
  compliance_report: ComplianceReport,
  policy_set: PolicySet,
  critique_verdict: CritiqueVerdict,
  quality_report: QualityReport,
  operating_digest: OperatingDigest,
  action_proposal: ActionProposal,
  handover_packet: HandoverPacket,
  run_memo: RunMemo,
} as const satisfies Record<ArtifactType, z.ZodTypeAny>;

export type ArtifactContentMap = {
  [K in ArtifactType]: z.infer<(typeof ARTIFACT_SCHEMAS)[K]>;
};

export type ArtifactContent<T extends ArtifactType = ArtifactType> = ArtifactContentMap[T];

export const ArtifactStatus = z.enum(["draft", "in_review", "accepted", "rejected", "superseded"]);
export type ArtifactStatus = z.infer<typeof ArtifactStatus>;

/** The durable envelope. `content` is validated against ARTIFACT_SCHEMAS[type]. */
export const ArtifactEnvelope = z.object({
  id: ArtifactId,
  ventureId: VentureId,
  runId: RunId,
  type: ArtifactType,
  version: z.number().int().positive(),
  parentId: ArtifactId.optional(),
  status: ArtifactStatus,
  content: z.unknown(),
  /** sha256 over the canonical JSON of `content`. Immutability check. */
  contentHash: z.string().length(64),
  storageKey: z.string().optional(),
  quality: ArtifactQuality,
  sources: z.array(SourceRef).default([]),
  createdByTaskId: TaskId.optional(),
  createdAt: Timestamp,
});
export type ArtifactEnvelope = z.infer<typeof ArtifactEnvelope>;

/**
 * Parses an envelope's content against the schema its type declares.
 *
 * The assertion is unavoidable and safe: for a concrete `T`, `ARTIFACT_SCHEMAS[T]`
 * *is* the schema whose inferred output defines `ArtifactContentMap[T]`, but
 * TypeScript cannot follow that equivalence through a generic index. It is
 * confined to these two functions so no caller ever needs its own cast.
 */
export function parseArtifactContent<T extends ArtifactType>(
  type: T,
  content: unknown,
): ArtifactContentMap[T] {
  const schema: z.ZodTypeAny = ARTIFACT_SCHEMAS[type];
  return schema.parse(content) as ArtifactContentMap[T];
}

export type ArtifactParseResult<T extends ArtifactType> =
  | { success: true; data: ArtifactContentMap[T] }
  | { success: false; issues: { path: string; message: string }[] };

export function safeParseArtifactContent<T extends ArtifactType>(
  type: T,
  content: unknown,
): ArtifactParseResult<T> {
  const schema: z.ZodTypeAny = ARTIFACT_SCHEMAS[type];
  const result = schema.safeParse(content);
  if (result.success) return { success: true, data: result.data as ArtifactContentMap[T] };
  return {
    success: false,
    issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  };
}

/** Artifact types the Critic reviews. Others are structural records. */
export const RUBRIC_BEARING: readonly ArtifactType[] = [
  "validation_report",
  "strategy_memo",
  "brand_system",
  "product_catalogue",
  "supply_plan",
  "content_set",
  "growth_plan",
  "operating_digest",
];
