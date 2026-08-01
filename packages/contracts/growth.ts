import { z } from "zod";
import { MetricKey } from "./metrics.js";
import { Currency, Micros, Timestamp } from "./primitives.js";
import { sourced } from "./sources.js";

/** Growth Engineer output. */

export const KeywordTarget = z.object({
  keyword: z.string().min(1),
  monthlyVolume: sourced(z.number().nonnegative()),
  difficulty: z.enum(["low", "moderate", "high"]),
  intent: z.enum(["informational", "commercial", "transactional", "navigational", "local"]),
  /** Which page owns this term. One page per term; no cannibalisation. */
  targetPath: z.string().startsWith("/"),
});

export const SeoStructure = z.object({
  targets: z.array(KeywordTarget).min(1),
  /** Internal link plan — the pre-launch gate checks these all resolve. */
  internalLinks: z.array(z.object({ from: z.string(), to: z.string(), anchor: z.string().min(1) })).default([]),
  schemaTypes: z.array(z.string().min(1)).default([]),
  sitemapPaths: z.array(z.string()).default([]),
});

export const ChannelPlan = z.object({
  channel: z.string().min(1),
  role: z.enum(["primary", "secondary", "experimental"]),
  weeklyBudgetMicros: Micros.optional(),
  currency: Currency.optional(),
  targetCacMicros: sourced(Micros).optional(),
  /** The first thing to try, specifically. Not "post consistently". */
  firstAction: z.string().min(1),
  successMetric: MetricKey,
  reviewAfterDays: z.number().int().positive(),
});

export const AdCreativeBrief = z.object({
  channel: z.string().min(1),
  format: z.enum(["static", "video", "carousel", "text", "collection"]),
  hook: z.string().min(1),
  /** Which objection from the strategy memo this creative answers. */
  answersObjection: z.string().min(1),
  visualBrief: z.string().min(1),
  cta: z.string().min(1),
});

export const LifecycleFlow = z.object({
  name: z.string().min(1),
  trigger: z.string().min(1),
  sequenceName: z.string().min(1),
  successMetric: MetricKey,
});

export const LaunchStep = z.object({
  day: z.number().int(),
  action: z.string().min(1),
  owner: z.enum(["kiln", "customer"]),
  channel: z.string().optional(),
  dependsOn: z.array(z.string()).default([]),
});

export const MeasurementPlan = z.object({
  /** Events to define before launch, so attribution is not retrofitted. */
  events: z
    .array(
      z.object({
        name: z.string().min(1),
        firesWhen: z.string().min(1),
        properties: z.array(z.string()).default([]),
      }),
    )
    .min(1),
  funnels: z.array(z.object({ name: z.string().min(1), steps: z.array(z.string().min(1)).min(2) })).default([]),
  /** Numbers that trigger an Operator action, defined before the data exists. */
  thresholds: z
    .array(
      z.object({
        metric: MetricKey,
        comparator: z.enum(["lt", "gt"]),
        value: z.number(),
        thenDo: z.string().min(1),
      }),
    )
    .default([]),
});

export const GrowthPlan = z.object({
  seo: SeoStructure,
  channels: z.array(ChannelPlan).min(1),
  adCreatives: z.array(AdCreativeBrief).default([]),
  lifecycle: z.array(LifecycleFlow).default([]),
  launchSequence: z.array(LaunchStep).min(1),
  measurement: MeasurementPlan,
  /** Local archetype: real local-intent terms, never spun duplicates. */
  localPages: z
    .array(z.object({ area: z.string().min(1), path: z.string().startsWith("/"), keyword: KeywordTarget }))
    .default([]),
  generatedAt: Timestamp,
});
export type GrowthPlan = z.infer<typeof GrowthPlan>;
