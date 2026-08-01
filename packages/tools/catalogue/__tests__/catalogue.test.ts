import { randomUUID } from "node:crypto";
import { synthesize } from "@kiln/model-gateway";
import { describe, expect, it } from "vitest";
import type { ToolContext } from "../../core/define.js";
import { createSandboxEgressClient } from "../../core/egress.js";
import { ALL_TOOLS } from "../index.js";
import { categoryScreen } from "../compliance/index.js";

const ctx: ToolContext = {
  runId: randomUUID(),
  ventureId: randomUUID(),
  accountId: randomUUID(),
  taskId: randomUUID(),
  agentId: "catalogue-test",
  seed: "catalogue-contract-seed",
  sandbox: true,
  grantedScopes: [],
  lease: async () => ({ id: "lease_test", provider: "simulated", expiresAt: "2026-08-01T12:00:00.000Z" }),
  http: createSandboxEgressClient(),
  logger: { debug() {}, info() {}, warn() {} },
};

describe("tool catalogue contracts", () => {
  it("contains every prompt-1 tool and no duplicate ids", () => {
    const expected = [
      "shopify.theme.install",
      "shopify.navigation.set",
      "shopify.tax.configure",
      "shopify.payments.configure",
      "shopify.discount.create",
      "shopify.checkout.brand",
      "site.build",
      "copy.draft",
      "moq.evaluate",
    ];
    const ids = ALL_TOOLS.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(expected));
  });

  // The check above names only nine tools, so deleting any of the other 83 passes
  // it silently. This pins the whole roster: a change becomes a deliberate diff.
  it("pins the full tool roster", () => {
    expect([...ALL_TOOLS.map((tool) => tool.id)].sort()).toMatchSnapshot();
  });

  it("returns schema-valid, deterministic simulations for every tool", async () => {
    for (const tool of ALL_TOOLS) {
      for (let sample = 0; sample < 3; sample++) {
        const input = synthesize(tool.input, `tool-input:${tool.id}:${sample}`) as never;
        const first = await tool.simulate(input, ctx);
        const parsed = tool.output.safeParse(first);
        expect(parsed.success, `${tool.id}: ${parsed.success ? "" : parsed.error.message}`).toBe(true);

        const second = await tool.simulate(input, ctx);
        expect(second, `${tool.id} simulation changed for the same seed`).toEqual(first);
      }
    }
  });

  it("hard-blocks prohibited categories in the deterministic screen", async () => {
    const result = await categoryScreen.simulate({
      description: "An MLM selling counterfeit firearms and THC products",
      productTypes: ["adult content"],
      jurisdictions: ["AU", "US"],
    }, ctx);
    expect(result.status).toBe("blocked");
    expect(result.findings.filter((finding) => finding.severity === "prohibited").length).toBeGreaterThanOrEqual(4);
  });
});
