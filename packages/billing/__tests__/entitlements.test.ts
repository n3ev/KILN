import type { EntitlementCapability } from "@kiln/contracts";
import { describe, expect, it } from "vitest";
import { can, grantedScopes, weeklyCreditMicros } from "../entitlements.js";
import { PLAN_CATALOGUE } from "../plans.js";

const founder = { entitlements: PLAN_CATALOGUE[0]!.entitlements };
const operator = { entitlements: PLAN_CATALOGUE[1]!.entitlements };
const studio = { entitlements: PLAN_CATALOGUE[2]!.entitlements };

describe("entitlement enforcement", () => {
  const cases: readonly [string, typeof founder, EntitlementCapability, unknown, boolean][] = [
    ["founder first venture", founder, "ventures.max", 1, true],
    ["founder second venture", founder, "ventures.max", 2, false],
    ["operator third venture", operator, "ventures.max", 3, true],
    ["operator fourth venture", operator, "ventures.max", 4, false],
    ["guided on founder", founder, "autonomy.max", "guided", true],
    ["autonomous on founder", founder, "autonomy.max", "autonomous", false],
    ["autonomous on operator", operator, "autonomy.max", "autonomous", true],
    ["deep model on founder", founder, "model.tier.max", "deep", false],
    ["deep model on operator", operator, "model.tier.max", "deep", true],
    ["known playbook", founder, "playbooks.allowed", "physical-shopify", true],
    ["custom playbook founder", founder, "playbooks.allowed", "custom", false],
    ["custom playbook studio", studio, "playbooks.allowed", "custom", true],
    ["granted scope", founder, "scopes.granted", "commerce:write", true],
    ["invalid scope", founder, "scopes.granted", "shell:execute", false],
    ["founder handover", founder, "handover.included", true, false],
    ["operator handover", operator, "handover.included", true, true],
    ["founder lane", founder, "lane.priority", true, false],
    ["studio lane", studio, "lane.priority", true, true],
    ["community support", founder, "support.tier", "community", true],
    ["dedicated support", operator, "support.tier", "dedicated", false],
    ["within credits", founder, "credits.weekly", 50_000, true],
    ["over credits", founder, "credits.weekly", 50_001, false],
  ];

  it.each(cases)("%s", (_name, account, capability, quantity, expected) => {
    expect(can(account, capability, quantity)).toBe(expected);
  });

  it("fails closed for malformed persisted JSON", () => {
    expect(can({ entitlements: {} }, "ventures.max", 1)).toBe(false);
  });

  it("migrates the legacy seed shape", () => {
    expect(can({
      entitlements: {
        activeVentures: 1,
        autonomy: ["supervised", "guided"],
        weeklyCredits: 50_000,
        modelTier: "standard",
        handoverIncluded: false,
      },
    }, "autonomy.max", "guided")).toBe(true);
  });

  it("derives grants and micros from entitlements", () => {
    expect(grantedScopes(founder, ["commerce:write", "shell:execute"])).toEqual(["commerce:write"]);
    expect(weeklyCreditMicros(founder)).toBe(50_000_000);
  });
});

