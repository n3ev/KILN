import {
  migrateEntitlements,
  Scope,
  type EntitlementCapability,
  type Entitlements,
} from "@kiln/contracts";

export interface EntitledAccount {
  readonly entitlements: unknown;
}

const AUTONOMY = ["supervised", "guided", "autonomous"] as const;
const MODEL_TIER = ["cheap", "standard", "deep"] as const;
const SUPPORT = ["community", "standard", "priority", "dedicated"] as const;

function requestedStrings(quantity: unknown): string[] | undefined {
  if (typeof quantity === "string") return [quantity];
  if (Array.isArray(quantity) && quantity.every((item) => typeof item === "string")) return quantity;
  return undefined;
}

function withinRank(values: readonly string[], allowed: string, requested: unknown): boolean {
  if (typeof requested !== "string") return false;
  const requestedRank = values.indexOf(requested);
  const allowedRank = values.indexOf(allowed);
  return requestedRank >= 0 && requestedRank <= allowedRank;
}

function assertNever(value: never): never {
  throw new Error(`Unknown entitlement capability: ${String(value)}`);
}

/** The one enforcement point for plan capabilities. */
export function can(
  account: EntitledAccount,
  capability: EntitlementCapability,
  quantity: unknown = true,
): boolean {
  let entitlements: Entitlements;
  try {
    entitlements = migrateEntitlements(account.entitlements);
  } catch {
    return false;
  }

  switch (capability) {
    case "ventures.max":
    case "credits.weekly":
      return typeof quantity === "number" && Number.isFinite(quantity) && quantity >= 0
        ? quantity <= entitlements[capability]
        : false;
    case "autonomy.max":
      return withinRank(AUTONOMY, entitlements[capability], quantity);
    case "model.tier.max":
      return withinRank(MODEL_TIER, entitlements[capability], quantity);
    case "support.tier":
      return withinRank(SUPPORT, entitlements[capability], quantity);
    case "playbooks.allowed": {
      const requested = requestedStrings(quantity);
      if (!requested) return false;
      const allowed = entitlements[capability];
      return allowed.includes("*") || requested.every((playbook) => allowed.includes(playbook));
    }
    case "scopes.granted": {
      const requested = requestedStrings(quantity);
      if (!requested || requested.some((scope) => !Scope.safeParse(scope).success)) return false;
      return requested.every((scope) => entitlements[capability].includes(scope as never));
    }
    case "handover.included":
    case "lane.priority":
      return quantity === false || entitlements[capability];
    default:
      return assertNever(capability);
  }
}

/** Computes the actual run grants: playbook requirements narrowed by the plan. */
export function grantedScopes(account: EntitledAccount, required: readonly string[]): string[] {
  return required.filter((scope) => can(account, "scopes.granted", scope));
}

export function weeklyCreditMicros(account: EntitledAccount): number {
  return migrateEntitlements(account.entitlements)["credits.weekly"] * 1_000;
}

