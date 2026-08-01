import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { slopLint } from "../index.js";

const KnownBad = z.array(z.object({ id: z.string(), text: z.string(), expectedRule: z.string() }));
const KnownGood = z.array(z.object({ id: z.string(), text: z.string() }));
const fixture = (name: string): unknown => JSON.parse(readFileSync(
  resolve(import.meta.dirname, `../../../../fixtures/slop/${name}.json`),
  "utf8",
));

describe("versioned slop corpora", () => {
  it("blocks every known-bad sample for the expected reason", () => {
    for (const sample of KnownBad.parse(fixture("known-bad"))) {
      const rules = slopLint(sample.text).findings.map((finding) => finding.rule);
      expect(rules, sample.id).toContain(sample.expectedRule);
    }
  });

  it("keeps the known-good false-positive rate at or below five per cent", () => {
    const samples = KnownGood.parse(fixture("known-good"));
    const falsePositives = samples.filter((sample) => !slopLint(sample.text).passed);
    const rate = falsePositives.length / samples.length;
    expect(falsePositives.map((sample) => sample.id)).toEqual([]);
    expect(rate).toBeLessThanOrEqual(0.05);
  });
});
