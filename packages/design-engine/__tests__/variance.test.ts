import { describe, expect, it } from "vitest";
import { analyseVariance, MIN_PAIRWISE_DISTANCE, tokenDistance } from "../distance.js";
import { contrastRatio, generatePalette, isForbiddenHue, oklchToHex } from "../palette.js";
import { createRng } from "../rng.js";
import { generateDesignTokens, toCssBlock } from "../tokens.js";
import { TYPE_PAIRINGS } from "../type-pairings.js";

const brands = (n: number) =>
  Array.from({ length: n }, (_, i) => generateDesignTokens({ seed: `brand-${i}` }));

describe("catalogue", () => {
  it("carries at least 24 pairings, as the doctrine requires", () => {
    expect(TYPE_PAIRINGS.length).toBeGreaterThanOrEqual(24);
  });

  it("gives every face a licence and a fallback stack", () => {
    for (const p of TYPE_PAIRINGS) {
      for (const face of [p.display, p.text]) {
        expect(face.licence, p.id).toBeTruthy();
        expect(face.fallbacks.length, p.id).toBeGreaterThan(0);
        expect(face.weights.length, p.id).toBeGreaterThan(0);
      }
    }
  });

  it("has no duplicate ids", () => {
    const ids = TYPE_PAIRINGS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("determinism", () => {
  it("produces identical tokens for identical seeds", () => {
    const a = generateDesignTokens({ seed: "ceramics-2026" });
    const b = generateDesignTokens({ seed: "ceramics-2026" });
    expect(a).toEqual(b);
    expect(tokenDistance(a, b)).toBe(0);
  });

  it("produces different tokens for different seeds", () => {
    const a = generateDesignTokens({ seed: "ceramics-2026" });
    const b = generateDesignTokens({ seed: "bike-repair-leeds" });
    expect(tokenDistance(a, b)).toBeGreaterThan(0);
  });

  it("keeps decision streams independent, so unrelated axes do not shift together", () => {
    // Pinning the layout must not change the type or palette choice.
    const free = generateDesignTokens({ seed: "fixed" });
    const pinned = generateDesignTokens({ seed: "fixed", layoutArchetype: "sidebar-index" });
    expect(pinned.typePairing.id).toBe(free.typePairing.id);
    expect(pinned.palette.roles.accent).toBe(free.palette.roles.accent);
    expect(pinned.layoutArchetype).toBe("sidebar-index");
  });
});

describe("50 generated brands", () => {
  const sets = brands(50);

  it("keeps every pair further apart than the threshold", () => {
    const report = analyseVariance(sets);
    expect(report.pairs).toBe((50 * 49) / 2);
    // Reported so a regression says *which* two brands collapsed together.
    expect(report.min, `closest pair: ${JSON.stringify(report.closest)}`).toBeGreaterThan(
      MIN_PAIRWISE_DISTANCE,
    );
  });

  it("spreads across the catalogue rather than favouring a handful", () => {
    const pairings = new Set(sets.map((s) => s.typePairing.id));
    const layouts = new Set(sets.map((s) => s.layoutArchetype));
    const strategies = new Set(sets.map((s) => s.palette.strategy));
    expect(pairings.size).toBeGreaterThanOrEqual(12);
    expect(layouts.size).toBeGreaterThanOrEqual(6);
    expect(strategies.size).toBeGreaterThanOrEqual(5);
  });

  it("never lands in the purple-to-blue corridor", () => {
    for (const s of sets) {
      for (const ramp of s.palette.ramps) {
        // Neutrals are near-achromatic; hue is meaningless there.
        if (ramp.name === "neutral") continue;
        const hue = ramp.stops[0]?.colour.h ?? 0;
        expect(isForbiddenHue(hue), `${s.seed} ${ramp.name} hue=${hue.toFixed(1)}`).toBe(false);
      }
    }
  });

  it("emits body text that clears WCAG AA against its own background", () => {
    for (const s of sets) {
      const check = s.palette.contrastChecks.find((c) => c.pair === "text-on-background");
      expect(check?.ratio ?? 0, s.seed).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("emits a usable CSS block for every brand", () => {
    for (const s of sets) {
      const css = toCssBlock(s);
      expect(css.startsWith(":root {"), s.seed).toBe(true);
      expect(css).toContain("--colour-background");
      expect(css).toContain("--font-display");
      expect(css).not.toContain("undefined");
      expect(css).not.toContain("NaN");
    }
  });
});

describe("palette", () => {
  it("rotates a forbidden preferred hue out of the corridor instead of refusing", () => {
    const palette = generatePalette(createRng("pref"), { preferredHue: 270 });
    const hue = palette.ramps[0]?.stops[0]?.colour.h ?? 0;
    expect(isForbiddenHue(hue)).toBe(false);
  });

  it("honours a permitted preferred hue", () => {
    const palette = generatePalette(createRng("pref2"), { preferredHue: 30 });
    expect(palette.ramps[0]?.stops[0]?.colour.h).toBeCloseTo(30, 0);
  });

  it("produces an uneven ramp, because evenly spaced steps are the tell", () => {
    const palette = generatePalette(createRng("ramp"), {});
    const ramp = palette.ramps[0];
    const gaps: number[] = [];
    for (let i = 1; i < (ramp?.stops.length ?? 0); i++) {
      const prev = ramp?.stops[i - 1]?.colour.l ?? 0;
      const cur = ramp?.stops[i]?.colour.l ?? 0;
      gaps.push(Math.abs(prev - cur));
    }
    const unique = new Set(gaps.map((g) => g.toFixed(3)));
    expect(unique.size).toBeGreaterThan(2);
  });

  it("picks accent text that is readable on the accent", () => {
    for (let i = 0; i < 25; i++) {
      const p = generatePalette(createRng(`accent-${i}`), {});
      const check = p.contrastChecks.find((c) => c.pair === "accent-text-on-accent");
      expect(check?.ratio ?? 0).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("emits real hex, never a culori failure sentinel", () => {
    const p = generatePalette(createRng("hex"), {});
    for (const value of Object.values(p.roles)) {
      expect(value).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("keeps generated colours inside sRGB", () => {
    const p = generatePalette(createRng("gamut"), {});
    for (const ramp of p.ramps) {
      for (const stop of ramp.stops) {
        expect(oklchToHex(stop.colour)).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
});

describe("contrast helper", () => {
  it("scores black on white at the known maximum", () => {
    expect(contrastRatio({ l: 0, c: 0, h: 0 }, { l: 1, c: 0, h: 0 })).toBeCloseTo(21, 0);
  });
});
