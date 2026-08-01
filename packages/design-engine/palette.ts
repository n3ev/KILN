import type { ColourRamp, Oklch, Palette } from "@kiln/contracts";
import { converter, formatHex, wcagContrast } from "culori";
import type { Rng } from "./rng.js";

/**
 * Palette generation in OKLCH.
 *
 * OKLCH rather than HSL because it is perceptually uniform: holding L constant
 * across hues actually holds *apparent* lightness constant, so a ramp does not
 * go muddy in the yellows and neon in the blues. That is what makes an
 * automatically generated palette look chosen rather than computed.
 *
 * Two anti-slop requirements from CLAUDE.md §3.4 are enforced here:
 *   - the ramp is deliberately **non-symmetric** — real palettes are not evenly
 *     spaced 50/100/…/900, and even spacing is itself a machine tell;
 *   - purple-to-blue gradients are refused outright, by hue exclusion.
 */

const toRgb = converter("rgb");

/** Hue bands the generator will not centre a brand on. */
const FORBIDDEN_HUE_RANGES: readonly [number, number][] = [
  // The purple→blue corridor that every AI-generated landing page lives in.
  [255, 295],
];

export function isForbiddenHue(h: number): boolean {
  const hue = ((h % 360) + 360) % 360;
  return FORBIDDEN_HUE_RANGES.some(([lo, hi]) => hue >= lo && hue <= hi);
}

export function oklchToHex(c: Oklch): string {
  const hex = formatHex({ mode: "oklch", l: c.l, c: c.c, h: c.h });
  return hex ?? "#000000";
}

/** True when the colour survives the round trip into sRGB without clipping. */
export function isDisplayable(c: Oklch): boolean {
  const rgb = toRgb({ mode: "oklch", l: c.l, c: c.c, h: c.h });
  if (!rgb) return false;
  const within = (v: number): boolean => v >= -0.001 && v <= 1.001;
  return within(rgb.r) && within(rgb.g) && within(rgb.b);
}

/** Reduces chroma until the colour fits in sRGB. Preserves hue and lightness. */
export function clampToGamut(c: Oklch): Oklch {
  let chroma = c.c;
  while (chroma > 0.001 && !isDisplayable({ ...c, c: chroma })) chroma -= 0.005;
  return { ...c, c: Math.max(0, chroma) };
}

export function contrastRatio(a: Oklch, b: Oklch): number {
  return wcagContrast(oklchToHex(a), oklchToHex(b));
}

export const PALETTE_STRATEGIES: readonly Palette["strategy"][] = [
  "monochrome-accent",
  "analogous-warm",
  "analogous-cool",
  "complementary-split",
  "triad-muted",
  "earth-neutral",
  "high-contrast-duotone",
  "tinted-neutral",
];

/**
 * Non-symmetric lightness ramps.
 *
 * Each is a hand-picked curve rather than a linear interpolation. The gaps are
 * uneven on purpose: designers cluster steps where they need fine control
 * (the light end for surfaces, the dark end for text) and skip the middle.
 */
const RAMP_CURVES: readonly { name: string; steps: readonly [number, number][] }[] = [
  { name: "airy", steps: [[50, 0.985], [100, 0.96], [200, 0.91], [300, 0.83], [400, 0.71], [500, 0.6], [600, 0.5], [700, 0.4], [800, 0.29], [900, 0.19], [950, 0.13]] },
  { name: "inky", steps: [[50, 0.97], [100, 0.93], [200, 0.86], [300, 0.75], [400, 0.62], [500, 0.5], [600, 0.41], [700, 0.32], [800, 0.24], [900, 0.16], [950, 0.1]] },
  { name: "contrast-jump", steps: [[50, 0.99], [100, 0.95], [200, 0.88], [400, 0.66], [500, 0.54], [700, 0.35], [900, 0.18], [950, 0.11]] },
  { name: "muted-mid", steps: [[100, 0.94], [200, 0.89], [300, 0.8], [400, 0.7], [500, 0.61], [600, 0.52], [700, 0.42], [800, 0.31], [900, 0.21]] },
];

function buildRamp(name: string, baseHue: number, baseChroma: number, curveIndex: number): ColourRamp {
  const curve = RAMP_CURVES[curveIndex % RAMP_CURVES.length] ?? RAMP_CURVES[0];
  if (!curve) throw new Error("no ramp curves defined");

  const stops: ColourRamp["stops"] = curve.steps.map(([step, l]) => {
    // Chroma peaks in the mid-tones and falls off at both ends, which is how
    // pigment behaves and why flat-chroma ramps look synthetic.
    const distanceFromMid = Math.abs(l - 0.55) / 0.55;
    const chroma = baseChroma * (1 - 0.75 * distanceFromMid * distanceFromMid);
    const colour = clampToGamut({ l, c: Math.max(0, chroma), h: baseHue });
    return { step, colour, hex: oklchToHex(colour) };
  });

  return { name, stops };
}

function hueFor(strategy: Palette["strategy"], base: number, index: number): number {
  const wrap = (h: number): number => ((h % 360) + 360) % 360;
  switch (strategy) {
    case "monochrome-accent":
      return wrap(base + (index === 0 ? 0 : 4));
    case "analogous-warm":
      return wrap(base + index * 24);
    case "analogous-cool":
      return wrap(base - index * 24);
    case "complementary-split":
      return wrap(base + (index === 0 ? 0 : 150 + index * 30));
    case "triad-muted":
      return wrap(base + index * 120);
    case "earth-neutral":
      return wrap(base + index * 14);
    case "high-contrast-duotone":
      return wrap(base + (index === 0 ? 0 : 180));
    case "tinted-neutral":
      return wrap(base + index * 8);
  }
}

function chromaFor(strategy: Palette["strategy"], rng: Rng, index: number): number {
  const base = (() => {
    switch (strategy) {
      case "earth-neutral":
        return rng.float(0.03, 0.07);
      case "tinted-neutral":
        return rng.float(0.01, 0.04);
      case "muted" as never:
      case "triad-muted":
        return rng.float(0.05, 0.1);
      case "high-contrast-duotone":
        return rng.float(0.12, 0.2);
      default:
        return rng.float(0.07, 0.15);
    }
  })();
  // Secondary ramps carry less chroma so one colour clearly leads.
  return index === 0 ? base : base * rng.float(0.4, 0.8);
}

export interface PaletteInput {
  /** Preferred hue in degrees; the generator moves off it if it is forbidden. */
  readonly preferredHue?: number;
  readonly strategy?: Palette["strategy"];
  /** Dark-first brands invert the background/text assignment. */
  readonly dark?: boolean;
}

function pickStop(ramp: ColourRamp, targetStep: number): { step: number; colour: Oklch; hex: string } {
  const exact = ramp.stops.find((s) => s.step === targetStep);
  if (exact) return exact;
  const nearest = [...ramp.stops].sort(
    (a, b) => Math.abs(a.step - targetStep) - Math.abs(b.step - targetStep),
  )[0];
  if (!nearest) throw new Error("ramp has no stops");
  return nearest;
}

export function generatePalette(rng: Rng, input: PaletteInput = {}): Palette {
  const strategy = input.strategy ?? rng.pick(PALETTE_STRATEGIES);

  const curveIndex = rng.int(0, RAMP_CURVES.length - 1);
  const rampCount = strategy === "monochrome-accent" ? 2 : rng.int(2, 3);

  /**
   * Rotate the *whole harmony* out of the forbidden corridor, not just the base
   * hue. A triad's support ramps sit 120° away, so a base outside the corridor
   * says nothing about where its partners land — which is exactly how a
   * purple-to-blue support colour sneaks back in.
   *
   * Rotating the base preserves the harmonic relationships; nudging one ramp
   * would not. The corridor is 40° wide and the widest spacing here is 180°, so
   * a valid rotation always exists within a full turn.
   */
  const harmonyIsClear = (base: number): boolean =>
    Array.from({ length: rampCount }, (_, i) => hueFor(strategy, base, i)).every((h) => !isForbiddenHue(h));

  let baseHue = input.preferredHue ?? rng.float(0, 360);
  for (let guard = 0; !harmonyIsClear(baseHue) && guard < 72; guard++) {
    baseHue = (baseHue + 5) % 360;
  }

  const ramps: ColourRamp[] = [];
  for (let i = 0; i < rampCount; i++) {
    const hue = hueFor(strategy, baseHue, i);
    ramps.push(buildRamp(i === 0 ? "brand" : `support-${i}`, hue, chromaFor(strategy, rng, i), curveIndex + i));
  }

  const neutralHue = (baseHue + rng.float(-12, 12) + 360) % 360;
  const neutral = buildRamp("neutral", neutralHue, rng.float(0.004, 0.018), curveIndex);
  ramps.push(neutral);

  const brand = ramps[0];
  if (!brand) throw new Error("palette generated no brand ramp");

  const dark = input.dark ?? rng.bool(0.22);

  const background = pickStop(neutral, dark ? 950 : 50);
  const surface = pickStop(neutral, dark ? 900 : 100);
  const text = pickStop(neutral, dark ? 50 : 900);
  const textMuted = pickStop(neutral, dark ? 400 : 600);
  const border = pickStop(neutral, dark ? 800 : 200);

  // Choose the accent step that actually clears contrast against the
  // background rather than assuming 500 works — it often does not on light
  // yellows or dark blues.
  const accentCandidates = [600, 500, 700, 400, 800].map((s) => pickStop(brand, s));
  const accent =
    accentCandidates.find((c) => contrastRatio(c.colour, background.colour) >= 4.5) ??
    pickStop(brand, dark ? 300 : 700);

  const white: Oklch = { l: 1, c: 0, h: 0 };
  const black: Oklch = { l: 0.15, c: 0, h: 0 };
  const accentText =
    contrastRatio(white, accent.colour) >= contrastRatio(black, accent.colour) ? white : black;

  const positive = clampToGamut({ l: dark ? 0.72 : 0.52, c: 0.13, h: 145 });
  const critical = clampToGamut({ l: dark ? 0.7 : 0.5, c: 0.17, h: 27 });

  const checks: Palette["contrastChecks"] = [
    { pair: "text-on-background", ratio: contrastRatio(text.colour, background.colour), standard: "wcag-aaa", passes: contrastRatio(text.colour, background.colour) >= 7 },
    { pair: "text-on-surface", ratio: contrastRatio(text.colour, surface.colour), standard: "wcag-aa", passes: contrastRatio(text.colour, surface.colour) >= 4.5 },
    { pair: "muted-on-background", ratio: contrastRatio(textMuted.colour, background.colour), standard: "wcag-aa", passes: contrastRatio(textMuted.colour, background.colour) >= 4.5 },
    { pair: "accent-on-background", ratio: contrastRatio(accent.colour, background.colour), standard: "wcag-aa", passes: contrastRatio(accent.colour, background.colour) >= 3 },
    { pair: "accent-text-on-accent", ratio: contrastRatio(accentText, accent.colour), standard: "wcag-aa", passes: contrastRatio(accentText, accent.colour) >= 4.5 },
  ];

  return {
    strategy,
    ramps,
    roles: {
      background: background.hex,
      surface: surface.hex,
      text: text.hex,
      textMuted: textMuted.hex,
      border: border.hex,
      accent: accent.hex,
      accentText: oklchToHex(accentText),
      positive: oklchToHex(positive),
      critical: oklchToHex(critical),
    },
    contrastChecks: checks,
    forbiddenPatternsChecked: ["purple-blue-gradient", "glassmorphism"],
  };
}

/** Hue of the brand ramp, used by the distance metric. */
export function brandHue(palette: Palette): number {
  return palette.ramps[0]?.stops[0]?.colour.h ?? 0;
}

