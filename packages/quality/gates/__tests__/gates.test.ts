import { describe, expect, it } from "vitest";
import {
  lighthouseGate,
  noBrokenLinksGate,
  noPlaceholdersGate,
  productDescriptionsGate,
  productImageryGate,
} from "../index.js";

describe("quality gates fail closed", () => {
  it("does not treat missing artifacts or probes as a clean result", () => {
    expect(productDescriptionsGate({}).passed).toBe(false);
    expect(productImageryGate({}).passed).toBe(false);
    expect(noBrokenLinksGate({}).passed).toBe(false);
    expect(noPlaceholdersGate({}).passed).toBe(false);
  });

  it("requires lighthouse evidence for all three primary templates", () => {
    const result = lighthouseGate({
      probes: {
        lighthouse: [
          { path: "/", performance: 100, accessibility: 100, seo: 100 },
          { path: "/product", performance: 100, accessibility: 100, seo: 100 },
        ],
      },
    });
    expect(result.passed).toBe(false);
    expect(result.assertions.every((assertion) => assertion.observed.includes("2/3"))).toBe(true);
  });
});
