import { z } from "zod";
import { Confidence, Timestamp } from "./primitives.js";
import { SourceRef } from "./sources.js";

/**
 * Brand contracts, including the design token set.
 *
 * The token schema is deliberately opinionated about *variance*. CLAUDE.md §3.4
 * requires that two runs never produce visually similar sites, so the schema
 * carries the axes along which brands must differ (type pairing, palette
 * strategy, spacing rhythm, edge personality, motion signature, layout
 * archetype) as first-class enumerated fields rather than as free-form CSS.
 * That makes pairwise distance computable, and therefore testable.
 */

// ── Typography ───────────────────────────────────────────────────────────────

export const FontLicence = z.enum(["ofl", "apache", "ubuntu-font-licence", "commercial", "system"]);

export const FontSpec = z.object({
  family: z.string().min(1),
  /** Where it comes from — needed for the handover packet's licence folder. */
  source: z.enum(["google", "fontshare", "bunny", "system", "self-hosted"]),
  licence: FontLicence,
  /** Set for commercial faces; the handover packet must include proof. */
  licenceUrl: z.string().url().optional(),
  weights: z.array(z.number().int().min(100).max(900)).min(1),
  italic: z.boolean().default(false),
  /** Fallback stack, in order, ending in a generic family. */
  fallbacks: z.array(z.string().min(1)).min(1),
});
export type FontSpec = z.infer<typeof FontSpec>;

export const TypePairing = z.object({
  id: z.string().min(1),
  display: FontSpec,
  text: FontSpec,
  /** Optional third face for small caps, code, or numerals. */
  accent: FontSpec.optional(),
  /** The feel this pairing carries. Used to match brand voice, not decorate. */
  character: z.enum([
    "editorial-serif",
    "swiss-grotesque",
    "humanist-warm",
    "geometric-precise",
    "brutalist-mono",
    "transitional-classic",
    "condensed-utility",
    "rounded-approachable",
  ]),
  /** Ratio between display and body size at the base step. */
  displayScale: z.number().min(1).max(6),
});
export type TypePairing = z.infer<typeof TypePairing>;

export const TypeScale = z.object({
  /** Base body size in px. Not always 16 — that uniformity is itself a tell. */
  basePx: z.number().min(14).max(20),
  /** Modular ratio: 1.125 minor second … 1.618 golden. */
  ratio: z.number().min(1.05).max(1.8),
  steps: z.record(z.string(), z.number()),
  /** Leading at body size. Tight editorial vs airy utility. */
  bodyLineHeight: z.number().min(1.1).max(2),
  displayLineHeight: z.number().min(0.85).max(1.4),
  /** Negative tracking on display type is a strong stylistic signal. */
  displayTrackingEm: z.number().min(-0.06).max(0.12),
});

// ── Colour ───────────────────────────────────────────────────────────────────

/** OKLCH triple. L 0–1, C 0–0.4ish, H degrees. Perceptually uniform. */
export const Oklch = z.object({
  l: z.number().min(0).max(1),
  c: z.number().min(0).max(0.5),
  h: z.number().min(0).max(360),
});
export type Oklch = z.infer<typeof Oklch>;

export const ColourRamp = z.object({
  name: z.string().min(1),
  /** Deliberately non-symmetric: real palettes are not 50/100/.../900 even. */
  stops: z.array(z.object({ step: z.number().int(), colour: Oklch, hex: z.string() })).min(3),
});
export type ColourRamp = z.infer<typeof ColourRamp>;

export const Palette = z.object({
  strategy: z.enum([
    "monochrome-accent",
    "analogous-warm",
    "analogous-cool",
    "complementary-split",
    "triad-muted",
    "earth-neutral",
    "high-contrast-duotone",
    "tinted-neutral",
  ]),
  ramps: z.array(ColourRamp).min(2),
  roles: z.object({
    background: z.string(),
    surface: z.string(),
    text: z.string(),
    textMuted: z.string(),
    border: z.string(),
    accent: z.string(),
    accentText: z.string(),
    positive: z.string(),
    critical: z.string(),
  }),
  /** Verified, not asserted: computed APCA/WCAG contrast for the pairs used. */
  contrastChecks: z
    .array(
      z.object({
        pair: z.string().min(1),
        ratio: z.number(),
        standard: z.enum(["wcag-aa", "wcag-aaa"]),
        passes: z.boolean(),
      }),
    )
    .min(1),
  /** Explicitly banned in §3.4; recorded so the check is visible in the artifact. */
  forbiddenPatternsChecked: z.array(z.string()).default(["purple-blue-gradient", "glassmorphism"]),
});
export type Palette = z.infer<typeof Palette>;

// ── Shape, space, motion ─────────────────────────────────────────────────────

export const SpacingRhythm = z.enum(["tight-4", "standard-8", "generous-8-wide", "editorial-golden"]);

export const EdgePersonality = z.object({
  /** 0 = hard square, 1 = pill. Drives radius across the whole system. */
  softness: z.number().min(0).max(1),
  radii: z.record(z.string(), z.string()),
  borderWidth: z.number().min(0).max(4),
  /** Shadow philosophy. `none` and `hard` are as valid as `soft`. */
  elevation: z.enum(["none", "hard-offset", "soft-diffuse", "inset", "border-only"]),
});

export const MotionSignature = z.object({
  /** Named easing that recurs everywhere, so motion reads as one hand. */
  easing: z.enum(["linear", "ease-out-quad", "ease-out-expo", "spring-gentle", "spring-snappy", "steps"]),
  durationMs: z.object({ fast: z.number(), base: z.number(), slow: z.number() }),
  /** What actually moves. Restraint is a style. */
  entrance: z.enum(["none", "fade", "rise", "slide", "scale", "clip-reveal"]),
  reducedMotionFallback: z.enum(["none", "fade"]).default("none"),
});

export const LayoutArchetype = z.enum([
  "editorial-column",
  "split-asymmetric",
  "catalogue-grid",
  "poster-typographic",
  "sidebar-index",
  "horizontal-scroll-gallery",
  "stacked-slab",
  "table-of-contents",
]);
export type LayoutArchetype = z.infer<typeof LayoutArchetype>;

export const DesignTokens = z.object({
  /** Deterministic from the run seed + brand inputs; enables replay diffing. */
  seed: z.string().min(1),
  typePairing: TypePairing,
  typeScale: TypeScale,
  palette: Palette,
  spacing: z.object({ rhythm: SpacingRhythm, basePx: z.number(), steps: z.record(z.string(), z.string()) }),
  edges: EdgePersonality,
  motion: MotionSignature,
  layoutArchetype: LayoutArchetype,
  /** Serialised as CSS custom properties for the generated site. */
  cssVariables: z.record(z.string(), z.string()),
});
export type DesignTokens = z.infer<typeof DesignTokens>;

// ── Voice ────────────────────────────────────────────────────────────────────

export const VoiceCharter = z.object({
  /** Three adjectives max, each with a concrete "which means" clause. */
  attributes: z
    .array(z.object({ attribute: z.string().min(1), whichMeans: z.string().min(1) }))
    .min(2)
    .max(4),
  /** Sentences the brand would write, and the near-miss it would not. */
  writes: z.array(z.string().min(1)).min(2),
  neverWrites: z.array(z.string().min(1)).min(2),
  readingLevel: z.enum(["plain", "considered", "technical"]),
  personPreference: z.enum(["first-singular", "first-plural", "second", "impersonal"]),
  /** Explicit opt-in — the slop linter blocks emoji in body copy otherwise. */
  emojiAllowed: z.boolean().default(false),
  /** Terms only this brand uses, and their definitions. Builds distinctiveness. */
  lexicon: z.array(z.object({ term: z.string().min(1), meaning: z.string().min(1) })).default([]),
  bannedWords: z.array(z.string().min(1)).default([]),
});
export type VoiceCharter = z.infer<typeof VoiceCharter>;

// ── Name and identity ────────────────────────────────────────────────────────

export const NameCandidate = z.object({
  name: z.string().min(1),
  rationale: z.string().min(1),
  /** Live availability at generation time, with the check recorded. */
  domains: z.array(
    z.object({
      domain: z.string().min(1),
      available: z.boolean(),
      priceMicros: z.number().int().optional(),
      renewalMicros: z.number().int().optional(),
      checkedAt: Timestamp,
    }),
  ),
  handles: z.array(
    z.object({ platform: z.string().min(1), handle: z.string().min(1), available: z.boolean() }),
  ),
  /** Advisory only. Never presented as legal clearance — see §10 identity. */
  trademarkScreen: z.object({
    status: z.enum(["clear-on-search", "possible-conflict", "conflict", "not-screened"]),
    advisory: z.literal(true),
    notes: z.string(),
    sources: z.array(SourceRef).default([]),
  }),
  pronounceability: Confidence,
  risks: z.array(z.string()).default([]),
});
export type NameCandidate = z.infer<typeof NameCandidate>;

export const BrandMark = z.object({
  kind: z.enum(["wordmark", "monogram", "pictorial", "combination"]),
  svg: z.string().min(1),
  storageKey: z.string().optional(),
  clearSpaceRatio: z.number().min(0),
  minWidthPx: z.number().int().positive(),
  variants: z.array(z.object({ name: z.string(), svg: z.string() })).default([]),
});

export const BrandSystem = z.object({
  chosenName: z.string().min(1),
  alternatives: z.array(NameCandidate).min(2),
  tokens: DesignTokens,
  voice: VoiceCharter,
  mark: BrandMark,
  /** Constrains every generated image so a product set looks like one shoot. */
  visualDirection: z.object({
    brief: z.string().min(1),
    photographyStyle: z.string().min(1),
    lighting: z.string().min(1),
    palette: z.string().min(1),
    composition: z.string().min(1),
    /** Passed as negative prompts to image generation. */
    avoid: z.array(z.string().min(1)).min(1),
  }),
  generatedAt: Timestamp,
});
export type BrandSystem = z.infer<typeof BrandSystem>;
