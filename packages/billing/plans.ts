import { Entitlements, Scope, type Entitlements as EntitlementValue } from "@kiln/contracts";

export interface PlanDefinition {
  readonly name: "Founder" | "Operator" | "Studio";
  readonly priceWeeklyCents: number;
  readonly entitlements: EntitlementValue;
}

const PLAYBOOKS = ["physical-shopify", "digital-product", "local-service"];
const BUILD_SCOPES = [...Scope.options];

function plan(value: PlanDefinition): PlanDefinition {
  return { ...value, entitlements: Entitlements.parse(value.entitlements) };
}

export const PLAN_CATALOGUE: readonly PlanDefinition[] = [
  plan({
    name: "Founder",
    priceWeeklyCents: 19_900,
    entitlements: {
      schemaVersion: 1,
      "ventures.max": 1,
      "autonomy.max": "guided",
      "credits.weekly": 50_000,
      "model.tier.max": "standard",
      "playbooks.allowed": PLAYBOOKS,
      "scopes.granted": BUILD_SCOPES,
      "support.tier": "community",
      "handover.included": false,
      "lane.priority": false,
    },
  }),
  plan({
    name: "Operator",
    priceWeeklyCents: 49_900,
    entitlements: {
      schemaVersion: 1,
      "ventures.max": 3,
      "autonomy.max": "autonomous",
      "credits.weekly": 200_000,
      "model.tier.max": "deep",
      "playbooks.allowed": PLAYBOOKS,
      "scopes.granted": BUILD_SCOPES,
      "support.tier": "priority",
      "handover.included": true,
      "lane.priority": false,
    },
  }),
  plan({
    name: "Studio",
    priceWeeklyCents: 120_000,
    entitlements: {
      schemaVersion: 1,
      "ventures.max": 10,
      "autonomy.max": "autonomous",
      "credits.weekly": 750_000,
      "model.tier.max": "deep",
      "playbooks.allowed": ["*"],
      "scopes.granted": BUILD_SCOPES,
      "support.tier": "dedicated",
      "handover.included": true,
      "lane.priority": true,
    },
  }),
] as const;

