import type { DesignTokens } from "@kiln/contracts";
import { brandHue } from "./palette.js";

/**
 * Distance in token space.
 *
 * CLAUDE.md §3.4: two runs must never produce visually similar sites, and that
 * claim is only worth making if it is measurable. This turns a token set into a
 * vector and defines a distance so the property can be asserted in a test
 * rather than eyeballed.
 *
 * The weights encode what a person actually notices first. Swapping the type
 * pairing changes a site's character far more than shifting a border radius by
 * 4px, so type and colour dominate and the shape axes are tie-breakers.
 */

export interface TokenVector {
  /** Categorical axes contribute 0 or 1 — same or different. */
  readonly typePairingId: string;
  readonly typeCharacter: string;
  readonly paletteStrategy: string;
  readonly spacingRhythm: string;
  readonly motionEasing: string;
  readonly motionEntrance: string;
  readonly elevation: string;
  readonly layoutArchetype: string;
  /** Continuous axes are normalised to 0–1 before weighting. */
  readonly hue: number;
  readonly baseSize: number;
  readonly scaleRatio: number;
  readonly softness: number;
  readonly bodyLineHeight: number;
}

const WEIGHTS = {
  typePairingId: 2.5,
  typeCharacter: 2.0,
  paletteStrategy: 1.5,
  hue: 2.0,
  layoutArchetype: 2.0,
  spacingRhythm: 1.0,
  elevation: 0.8,
  motionEasing: 0.5,
  motionEntrance: 0.5,
  softness: 0.8,
  baseSize: 0.4,
  scaleRatio: 0.4,
  bodyLineHeight: 0.3,
} as const;

const TOTAL_WEIGHT = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);

export function toVector(tokens: DesignTokens): TokenVector {
  return {
    typePairingId: tokens.typePairing.id,
    typeCharacter: tokens.typePairing.character,
    paletteStrategy: tokens.palette.strategy,
    spacingRhythm: tokens.spacing.rhythm,
    motionEasing: tokens.motion.easing,
    motionEntrance: tokens.motion.entrance,
    elevation: tokens.edges.elevation,
    layoutArchetype: tokens.layoutArchetype,
    hue: brandHue(tokens.palette),
    baseSize: tokens.typeScale.basePx,
    scaleRatio: tokens.typeScale.ratio,
    softness: tokens.edges.softness,
    bodyLineHeight: tokens.typeScale.bodyLineHeight,
  };
}

/** Shortest angular separation, normalised so 180° apart scores 1. */
function hueDistance(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360;
  return (raw > 180 ? 360 - raw : raw) / 180;
}

const categorical = (a: string, b: string): number => (a === b ? 0 : 1);
const scaled = (a: number, b: number, range: number): number => Math.min(1, Math.abs(a - b) / range);

/**
 * Weighted distance in [0, 1]. 0 is identical; 1 would require differing
 * maximally on every axis simultaneously, which no real pair reaches.
 */
export function tokenDistance(a: DesignTokens, b: DesignTokens): number {
  const va = toVector(a);
  const vb = toVector(b);

  const sum =
    WEIGHTS.typePairingId * categorical(va.typePairingId, vb.typePairingId) +
    WEIGHTS.typeCharacter * categorical(va.typeCharacter, vb.typeCharacter) +
    WEIGHTS.paletteStrategy * categorical(va.paletteStrategy, vb.paletteStrategy) +
    WEIGHTS.spacingRhythm * categorical(va.spacingRhythm, vb.spacingRhythm) +
    WEIGHTS.motionEasing * categorical(va.motionEasing, vb.motionEasing) +
    WEIGHTS.motionEntrance * categorical(va.motionEntrance, vb.motionEntrance) +
    WEIGHTS.elevation * categorical(va.elevation, vb.elevation) +
    WEIGHTS.layoutArchetype * categorical(va.layoutArchetype, vb.layoutArchetype) +
    WEIGHTS.hue * hueDistance(va.hue, vb.hue) +
    WEIGHTS.baseSize * scaled(va.baseSize, vb.baseSize, 4) +
    WEIGHTS.scaleRatio * scaled(va.scaleRatio, vb.scaleRatio, 0.5) +
    WEIGHTS.softness * scaled(va.softness, vb.softness, 1) +
    WEIGHTS.bodyLineHeight * scaled(va.bodyLineHeight, vb.bodyLineHeight, 0.3);

  return sum / TOTAL_WEIGHT;
}

/** The threshold the 50-brand variance test asserts against. */
export const MIN_PAIRWISE_DISTANCE = 0.12;

export interface VarianceReport {
  readonly pairs: number;
  readonly min: number;
  readonly mean: number;
  readonly closest?: { a: string; b: string; distance: number };
}

export function analyseVariance(sets: readonly DesignTokens[]): VarianceReport {
  let min = Infinity;
  let total = 0;
  let pairs = 0;
  let closest: VarianceReport["closest"];

  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const a = sets[i];
      const b = sets[j];
      if (!a || !b) continue;
      const d = tokenDistance(a, b);
      total += d;
      pairs++;
      if (d < min) {
        min = d;
        closest = { a: a.seed, b: b.seed, distance: d };
      }
    }
  }

  return {
    pairs,
    min: pairs === 0 ? 1 : min,
    mean: pairs === 0 ? 1 : total / pairs,
    ...(closest ? { closest } : {}),
  };
}
