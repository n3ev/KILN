import { describe, expect, it } from "vitest";
import { z } from "zod";
import { synthesize } from "../../packages/model-gateway/synth.js";
import * as contracts from "../../packages/contracts/index.js";

function exportedSchemas(): [string, z.ZodTypeAny][] {
  return Object.entries(contracts)
    .filter((entry): entry is [string, z.ZodTypeAny] => entry[1] instanceof z.ZodType)
    .sort(([left], [right]) => left.localeCompare(right));
}

describe("public contract serialization", () => {
  it("discovers a substantive public schema surface", () => {
    expect(exportedSchemas().length).toBeGreaterThan(100);
  });

  for (const [name, schema] of exportedSchemas()) {
    it(`${name} survives a JSON round trip`, () => {
      const generated = synthesize(schema, `contract-roundtrip:${name}`);
      const before = schema.parse(generated);
      const encoded = JSON.stringify(before);
      expect(encoded, `${name} must be JSON serializable`).toBeTypeOf("string");
      const after = schema.parse(JSON.parse(encoded));
      expect(after).toEqual(before);
    });
  }
});
