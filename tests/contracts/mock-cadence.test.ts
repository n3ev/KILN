import { describe, expect, it } from "vitest";
import { SENTENCE_BANDS, synthString, templateRng } from "../../packages/model-gateway/templates.js";
import { createRng } from "../../packages/model-gateway/rng.js";
import { slopLint } from "../../packages/quality/index.js";
import { countWords, splitSentences } from "../../packages/quality/slop-lint/text.js";
import { THRESHOLDS } from "../../packages/quality/slop-lint/rule-core.js";

/**
 * The mock's prose has to satisfy the linter at any length, for any seed.
 *
 * It used to do so by accident — one pool of similar-length sentences whose
 * word counts happened not to line up — which meant the only way to keep
 * `sentence-length-uniformity` quiet was to keep every paragraph long. That
 * pushed two agents past their context budgets on the golden run. The
 * generator now varies length structurally, and these tests hold it to the
 * three properties that make the guarantee real rather than lucky.
 */

const BANDS = [
  { name: "short", lines: SENTENCE_BANDS.SHORT_LINES, min: 5, max: 8 },
  { name: "medium", lines: SENTENCE_BANDS.MEDIUM_LINES, min: 11, max: 16 },
  { name: "long", lines: SENTENCE_BANDS.LONG_LINES, min: 20, max: 26 },
] as const;

describe("mock sentence bands", () => {
  it("keeps every sentence inside its band, for every substitution", () => {
    for (const band of BANDS) {
      for (const [index, line] of band.lines.entries()) {
        for (let seed = 0; seed < 60; seed++) {
          const words = countWords(line(createRng(`band-${band.name}-${index}-${seed}`)));
          expect(
            words,
            `${band.name}[${index}] produced ${words} words: ${line(createRng(`band-${band.name}-${index}-${seed}`))}`,
          ).toBeGreaterThanOrEqual(band.min);
          expect(words, `${band.name}[${index}]`).toBeLessThanOrEqual(band.max);
        }
      }
    }
  });

  it("separates the bands by more than the uniformity tolerance", () => {
    // The whole guarantee rests on this: if a window of three sentences spans
    // two bands then its min and max come from different bands, so the ratio
    // the rule measures cannot land inside the tolerance.
    for (let i = 0; i + 1 < BANDS.length; i++) {
      const lower = BANDS[i]!;
      const upper = BANDS[i + 1]!;
      const ratio = (upper.min - lower.max) / lower.max;
      expect(ratio, `${lower.name} → ${upper.name}`).toBeGreaterThan(THRESHOLDS.uniformSentenceTolerance);
    }
  });

  it("never takes three consecutive sentences from one band, including the wrap", () => {
    for (const cadence of SENTENCE_BANDS.CADENCES) {
      expect(cadence.length).toBeGreaterThanOrEqual(THRESHOLDS.uniformSentenceRun);
      // Walked twice so the repeat boundary is covered: a paragraph longer than
      // one cycle wraps, and that join is a window like any other.
      const doubled = [...cadence, ...cadence];
      for (let i = 0; i + THRESHOLDS.uniformSentenceRun <= doubled.length; i++) {
        const window = doubled.slice(i, i + THRESHOLDS.uniformSentenceRun);
        expect(new Set(window).size, `${cadence.join(",")} at ${i}`).toBeGreaterThan(1);
      }
    }
  });

  it("stays above the linter's five-word floor, so short lines still count", () => {
    // Sentences under five words are skipped by the uniformity rule. Building
    // the variation out of those would satisfy the linter without varying
    // anything it actually measures.
    expect(BANDS[0]!.min).toBeGreaterThanOrEqual(THRESHOLDS.uniformitySentenceMinWords);
  });
});

/** Field names whose generator produces a paragraph, and what constrains it. */
const PROSE_FIELDS = [
  "description",
  "shortDescription",
  "excerpt",
  "rationale",
  "reasoning",
  "narrative",
  "body",
  "text",
  "copy",
  "note",
  "notes",
  "summary",
  "label",
  "value",
  "messages",
  "blocks",
  "policies",
] as const;

describe("mock prose satisfies the linter it is graded by", () => {
  it("passes slop-lint for every prose field across many seeds", () => {
    const failures: string[] = [];
    for (const key of PROSE_FIELDS) {
      for (let seed = 0; seed < 80; seed++) {
        const path = ["artifact", "section", key];
        const value = synthString({ key, path, rng: templateRng(`cadence-${seed}`, path) });
        const result = slopLint(value);
        if (!result.passed) {
          const rules = result.findings.filter((f) => f.severity === "block").map((f) => f.rule);
          failures.push(`${key} seed ${seed}: ${rules.join(", ")}\n${value}`);
        }
      }
    }
    expect(failures.slice(0, 3).join("\n\n")).toBe("");
  });

  it("holds under a schema minLength, where padding used to join two paragraphs", () => {
    const failures: string[] = [];
    for (const key of ["sku", "handle", "email", "excerpt", "label"]) {
      for (const minLength of [200, 600, 1200]) {
        for (let seed = 0; seed < 20; seed++) {
          const path = ["artifact", key];
          const value = synthString({ key, path, rng: templateRng(`pad-${seed}`, path), minLength });
          if (value.length < minLength) failures.push(`${key}/${minLength}: too short (${value.length})`);
          const result = slopLint(value);
          if (!result.passed) {
            failures.push(`${key}/${minLength} seed ${seed}: ${result.findings.map((f) => f.rule).join(", ")}`);
          }
        }
      }
    }
    expect(failures.slice(0, 3).join("\n")).toBe("");
  });

  it("does not repeat a sentence inside one paragraph", () => {
    // The old generator cycled five sentences to reach its word target, so
    // every 120-word product description shipped the same lines twice.
    const repeats: string[] = [];
    for (const key of ["description", "rationale", "excerpt"]) {
      for (let seed = 0; seed < 80; seed++) {
        const path = ["artifact", key];
        const texts = splitSentences(
          synthString({ key, path, rng: templateRng(`repeat-${seed}`, path) }),
        ).map((s) => s.text);
        if (new Set(texts).size !== texts.length) repeats.push(`${key} seed ${seed}`);
      }
    }
    expect(repeats.slice(0, 5)).toEqual([]);
  });

  it("keeps product descriptions above the 120-word launch gate", () => {
    // CLAUDE.md §11.5, enforced by productDescriptionsGate. Shortening the
    // catch-all generators must not quietly take descriptions with it.
    for (let seed = 0; seed < 80; seed++) {
      const path = ["product_catalogue", "products", "0", "description"];
      const value = synthString({ key: "description", path, rng: templateRng(`gate-${seed}`, path) });
      expect(countWords(value), `seed ${seed}`).toBeGreaterThanOrEqual(120);
    }
  });

  it("fits a capped field instead of generating prose and chopping it", () => {
    // `shortDescription` (300) and `seo.description` (160) match the same
    // pattern as a product description. They used to be generated at 130 words
    // and truncated mid-sentence, which is what the customer then read.
    for (const [key, maxLength] of [["shortDescription", 300], ["description", 160]] as const) {
      for (let seed = 0; seed < 40; seed++) {
        const path = ["artifact", key];
        const value = synthString({ key, path, rng: templateRng(`cap-${seed}`, path), maxLength });
        expect(value.length, `${key} seed ${seed}`).toBeLessThanOrEqual(maxLength);
        expect(value.trimEnd().endsWith("."), `${key} seed ${seed}: ${value}`).toBe(true);
      }
    }
  });
});
