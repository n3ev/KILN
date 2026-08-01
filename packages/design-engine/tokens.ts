import type { DesignTokens, LayoutArchetype, TypePairing } from "@kiln/contracts";
import { generatePalette, type PaletteInput } from "./palette.js";
import { createRng, type Rng } from "./rng.js";
import { CHARACTER_BY_TONE, pairingsForCharacters, TYPE_PAIRINGS } from "./type-pairings.js";

/**
 * Design token generation.
 *
 * Everything is a function of the seed, so two runs of the same brief produce
 * identical tokens and two different briefs produce genuinely different ones.
 * The axes below are the ones CLAUDE.md §3.4 requires be varied, and each is
 * drawn from its own forked RNG stream so adding a new axis later cannot shift
 * the choices of the existing ones.
 */

// ── Spacing ──────────────────────────────────────────────────────────────────

export const SPACING_RHYTHMS = {
  "tight-4": { base: 4, scale: [0, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128] },
  "standard-8": { base: 8, scale: [0, 4, 8, 16, 24, 32, 48, 64, 96, 128, 192] },
  "generous-8-wide": { base: 8, scale: [0, 8, 16, 24, 40, 64, 96, 144, 208, 288, 384] },
  // 1.618 steps, rounded to whole pixels. Uneven by construction.
  "editorial-golden": { base: 8, scale: [0, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377] },
} as const satisfies Record<DesignTokens["spacing"]["rhythm"], { base: number; scale: readonly number[] }>;

const SPACING_NAMES = ["0", "3xs", "2xs", "xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl"] as const;

// ── Edges ────────────────────────────────────────────────────────────────────

export const EDGE_PERSONALITIES = [
  { softness: 0, elevation: "border-only", borderWidth: 1, radii: { none: "0", sm: "0", md: "0", lg: "0", full: "0" } },
  { softness: 0.08, elevation: "hard-offset", borderWidth: 2, radii: { none: "0", sm: "2px", md: "3px", lg: "4px", full: "999px" } },
  { softness: 0.25, elevation: "border-only", borderWidth: 1, radii: { none: "0", sm: "3px", md: "6px", lg: "10px", full: "999px" } },
  { softness: 0.45, elevation: "soft-diffuse", borderWidth: 1, radii: { none: "0", sm: "6px", md: "10px", lg: "16px", full: "999px" } },
  { softness: 0.7, elevation: "soft-diffuse", borderWidth: 0, radii: { none: "0", sm: "10px", md: "18px", lg: "28px", full: "999px" } },
  { softness: 0.9, elevation: "none", borderWidth: 0, radii: { none: "0", sm: "16px", md: "28px", lg: "40px", full: "999px" } },
  { softness: 0.3, elevation: "inset", borderWidth: 1, radii: { none: "0", sm: "4px", md: "8px", lg: "12px", full: "999px" } },
] as const;

// ── Motion ───────────────────────────────────────────────────────────────────

export const MOTION_SIGNATURES = [
  { easing: "ease-out-expo", durationMs: { fast: 120, base: 240, slow: 480 }, entrance: "rise" },
  { easing: "spring-gentle", durationMs: { fast: 160, base: 320, slow: 620 }, entrance: "fade" },
  { easing: "spring-snappy", durationMs: { fast: 90, base: 180, slow: 320 }, entrance: "scale" },
  { easing: "ease-out-quad", durationMs: { fast: 140, base: 260, slow: 420 }, entrance: "slide" },
  { easing: "steps", durationMs: { fast: 60, base: 120, slow: 200 }, entrance: "none" },
  { easing: "linear", durationMs: { fast: 100, base: 200, slow: 400 }, entrance: "clip-reveal" },
] as const;

// ── Layout ───────────────────────────────────────────────────────────────────

export const LAYOUT_ARCHETYPES: readonly LayoutArchetype[] = [
  "editorial-column",
  "split-asymmetric",
  "catalogue-grid",
  "poster-typographic",
  "sidebar-index",
  "horizontal-scroll-gallery",
  "stacked-slab",
  "table-of-contents",
];

/** Which layouts suit which archetype. A service site is not a catalogue. */
export const LAYOUTS_BY_ARCHETYPE: Readonly<Record<string, readonly LayoutArchetype[]>> = {
  physical: ["catalogue-grid", "editorial-column", "split-asymmetric", "horizontal-scroll-gallery", "stacked-slab"],
  digital: ["poster-typographic", "table-of-contents", "split-asymmetric", "editorial-column", "sidebar-index"],
  service: ["split-asymmetric", "stacked-slab", "editorial-column", "sidebar-index"],
};

// ── Type scale ───────────────────────────────────────────────────────────────

const SCALE_RATIOS = [1.125, 1.2, 1.25, 1.333, 1.414, 1.5, 1.618];
const STEP_NAMES = ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl"] as const;

function buildTypeScale(rng: Rng, pairing: TypePairing): DesignTokens["typeScale"] {
  // Not always 16px. A uniform 16px base across every site is itself a tell.
  const basePx = rng.pick([15, 16, 16, 17, 18]);
  const ratio = rng.pick(SCALE_RATIOS);

  const steps: Record<string, number> = {};
  STEP_NAMES.forEach((name, i) => {
    const exponent = i - 2; // "base" is index 2
    steps[name] = Math.round(basePx * Math.pow(ratio, exponent) * 100) / 100;
  });

  return {
    basePx,
    ratio,
    steps,
    bodyLineHeight: Math.round(rng.float(1.45, 1.72) * 100) / 100,
    displayLineHeight: Math.round(rng.float(0.92, 1.16) * 100) / 100,
    // Tight tracking on large display type; looser on condensed faces.
    displayTrackingEm:
      pairing.character === "condensed-utility"
        ? Math.round(rng.float(0, 0.04) * 1000) / 1000
        : Math.round(rng.float(-0.045, -0.005) * 1000) / 1000,
  };
}

// ── Assembly ─────────────────────────────────────────────────────────────────

export interface TokenInput {
  /** Run seed plus brand name — identical inputs must give identical output. */
  readonly seed: string;
  /** Steers type character. Drawn from the voice charter's attributes. */
  readonly tone?: keyof typeof CHARACTER_BY_TONE;
  readonly archetype?: "physical" | "digital" | "service";
  readonly palette?: PaletteInput;
  /** Pins the layout when a playbook or a customer has already chosen. */
  readonly layoutArchetype?: LayoutArchetype;
}

export function generateDesignTokens(input: TokenInput): DesignTokens {
  const root = createRng(input.seed);

  const typeRng = root.fork("type");
  const candidates = input.tone
    ? pairingsForCharacters(CHARACTER_BY_TONE[input.tone] ?? [])
    : TYPE_PAIRINGS;
  const typePairing = typeRng.pick(candidates);
  const typeScale = buildTypeScale(typeRng, typePairing);

  const palette = generatePalette(root.fork("palette"), input.palette ?? {});

  const spacingRng = root.fork("spacing");
  const rhythm = spacingRng.pick(
    Object.keys(SPACING_RHYTHMS) as (keyof typeof SPACING_RHYTHMS)[],
  );
  const spacingSpec = SPACING_RHYTHMS[rhythm];
  const spacingSteps: Record<string, string> = {};
  SPACING_NAMES.forEach((name, i) => {
    spacingSteps[name] = `${spacingSpec.scale[i] ?? 0}px`;
  });

  const edges = root.fork("edges").pick(EDGE_PERSONALITIES);
  const motion = root.fork("motion").pick(MOTION_SIGNATURES);

  const layoutRng = root.fork("layout");
  const layoutPool = input.archetype ? (LAYOUTS_BY_ARCHETYPE[input.archetype] ?? LAYOUT_ARCHETYPES) : LAYOUT_ARCHETYPES;
  const layoutArchetype = input.layoutArchetype ?? layoutRng.pick(layoutPool);

  const tokens: DesignTokens = {
    seed: input.seed,
    typePairing,
    typeScale,
    palette,
    spacing: { rhythm, basePx: spacingSpec.base, steps: spacingSteps },
    edges: {
      softness: edges.softness,
      radii: { ...edges.radii },
      borderWidth: edges.borderWidth,
      elevation: edges.elevation,
    },
    motion: {
      easing: motion.easing,
      durationMs: { ...motion.durationMs },
      entrance: motion.entrance,
      reducedMotionFallback: motion.entrance === "none" ? "none" : "fade",
    },
    layoutArchetype,
    cssVariables: {},
  };

  return { ...tokens, cssVariables: toCssVariables(tokens) };
}

const EASING_CSS: Record<DesignTokens["motion"]["easing"], string> = {
  linear: "linear",
  "ease-out-quad": "cubic-bezier(0.25, 0.46, 0.45, 0.94)",
  "ease-out-expo": "cubic-bezier(0.19, 1, 0.22, 1)",
  "spring-gentle": "cubic-bezier(0.34, 1.26, 0.64, 1)",
  "spring-snappy": "cubic-bezier(0.22, 1.61, 0.36, 1)",
  steps: "steps(4, end)",
};

const ELEVATION_CSS: Record<DesignTokens["edges"]["elevation"], string> = {
  none: "none",
  "hard-offset": "4px 4px 0 0 var(--colour-text)",
  "soft-diffuse": "0 1px 2px rgb(0 0 0 / 0.04), 0 8px 24px rgb(0 0 0 / 0.06)",
  inset: "inset 0 1px 2px rgb(0 0 0 / 0.08)",
  "border-only": "none",
};

/** Serialises tokens as CSS custom properties for the generated site. */
export function toCssVariables(tokens: DesignTokens): Record<string, string> {
  const vars: Record<string, string> = {
    "--font-display": [tokens.typePairing.display.family, ...tokens.typePairing.display.fallbacks]
      .map((f) => (f.includes(" ") ? `"${f}"` : f))
      .join(", "),
    "--font-text": [tokens.typePairing.text.family, ...tokens.typePairing.text.fallbacks]
      .map((f) => (f.includes(" ") ? `"${f}"` : f))
      .join(", "),
    "--font-size-base": `${tokens.typeScale.basePx}px`,
    "--line-height-body": String(tokens.typeScale.bodyLineHeight),
    "--line-height-display": String(tokens.typeScale.displayLineHeight),
    "--tracking-display": `${tokens.typeScale.displayTrackingEm}em`,
    "--border-width": `${tokens.edges.borderWidth}px`,
    "--elevation": ELEVATION_CSS[tokens.edges.elevation],
    "--easing": EASING_CSS[tokens.motion.easing],
    "--duration-fast": `${tokens.motion.durationMs.fast}ms`,
    "--duration-base": `${tokens.motion.durationMs.base}ms`,
    "--duration-slow": `${tokens.motion.durationMs.slow}ms`,
  };

  for (const [name, size] of Object.entries(tokens.typeScale.steps)) {
    vars[`--font-size-${name}`] = `${size}px`;
  }
  for (const [name, value] of Object.entries(tokens.spacing.steps)) {
    vars[`--space-${name}`] = value;
  }
  for (const [name, value] of Object.entries(tokens.edges.radii)) {
    vars[`--radius-${name}`] = value;
  }
  for (const [role, hex] of Object.entries(tokens.palette.roles)) {
    vars[`--colour-${role.replace(/([A-Z])/g, "-$1").toLowerCase()}`] = hex;
  }
  for (const ramp of tokens.palette.ramps) {
    for (const stop of ramp.stops) {
      vars[`--colour-${ramp.name}-${stop.step}`] = stop.hex;
    }
  }

  return vars;
}

/** Emits a `:root { … }` block for injection into a generated site. */
export function toCssBlock(tokens: DesignTokens): string {
  const lines = Object.entries(tokens.cssVariables).map(([k, v]) => `  ${k}: ${v};`);
  return `:root {\n${lines.join("\n")}\n}`;
}
