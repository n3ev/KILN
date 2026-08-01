import { describe, expect, it } from "vitest";
import { FALLBACK_SENTENCES } from "../../packages/model-gateway/templates.js";
import fixtureFillerDictionary from "../../packages/quality/dictionaries/fixture-filler.json" with { type: "json" };
import { fixtureFillerRule } from "../../packages/quality/slop-lint/rules.js";
import { buildContext } from "../../packages/quality/slop-lint/rule-core.js";

/**
 * The mock provider's fallback sentences are grammatical, unhedged and free of
 * every pattern the other slop rules look for. Before `fixture-filler` existed,
 * an artifact made entirely of them cleared every gate — the linter could not
 * see its own scaffolding. These tests keep that hole closed.
 */
describe("mock fixture filler is visible to the quality gate", () => {
  it("keeps the gateway's fallback list and the linter's dictionary identical", () => {
    expect([...fixtureFillerDictionary.sentences].sort()).toEqual([...FALLBACK_SENTENCES].sort());
  });

  it("blocks every sentence the gateway can emit as a fallback", () => {
    for (const sentence of FALLBACK_SENTENCES) {
      const findings = fixtureFillerRule.check(buildContext(sentence, {}));
      expect(findings, sentence).toHaveLength(1);
      expect(findings[0]?.severity).toBe("block");
    }
  });

  it("reports one finding per occurrence, with a span over the sentence", () => {
    const sentence = FALLBACK_SENTENCES[0]!;
    const text = `${sentence} A real sentence sits between them. ${sentence}`;
    const findings = fixtureFillerRule.check(buildContext(text, {}));
    expect(findings).toHaveLength(2);
    expect(text.slice(findings[0]!.span.start, findings[0]!.span.end)).toBe(sentence);
    expect(text.slice(findings[1]!.span.start, findings[1]!.span.end)).toBe(sentence);
  });

  it("leaves real copy alone", () => {
    const clean = "The tray measures 24 centimetres across and weighs 680 grams. It fits four mugs.";
    expect(fixtureFillerRule.check(buildContext(clean, {}))).toHaveLength(0);
  });
});
