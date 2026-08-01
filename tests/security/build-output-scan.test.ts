import { describe, expect, it } from "vitest";
import { scanText, shannonEntropy } from "../../scripts/secret-scanner.js";

describe("build-output secret scanner", () => {
  it("detects recognised credentials without echoing their plaintext", () => {
    const key = ["sk", "live", "51N4vB7qP2wZ8cT6mR3xK9dF"].join("_");
    const findings = scanText("bundle.js", `const checkout = "${key}";`);
    expect(findings).toMatchObject([{ file: "bundle.js", rule: "stripe-key" }]);
    expect(JSON.stringify(findings)).not.toContain(key);
  });

  it("flags high-entropy values only in secret-bearing assignments", () => {
    const value = "bG9uZy1yYW5kb20tc2VjcmV0LXZhbHVlLTIwMjY=";
    expect(shannonEntropy(value)).toBeGreaterThan(3.5);
    expect(scanText("bundle.js", `const apiKey = "${value}";`)).toHaveLength(1);
    expect(scanText("bundle.js", `const contentHash = "${value}";`)).toHaveLength(0);
  });
});
