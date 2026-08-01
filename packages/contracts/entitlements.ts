import { z } from "zod";
import { Scope } from "./scopes.js";

export const ENTITLEMENT_SCHEMA_VERSION = 1 as const;

export const EntitlementsV1 = z.object({
  schemaVersion: z.literal(ENTITLEMENT_SCHEMA_VERSION),
  "ventures.max": z.number().int().nonnegative(),
  "autonomy.max": z.enum(["supervised", "guided", "autonomous"]),
  "credits.weekly": z.number().int().nonnegative(),
  "model.tier.max": z.enum(["cheap", "standard", "deep"]),
  "playbooks.allowed": z.array(z.string().min(1)).min(1),
  "scopes.granted": z.array(Scope),
  "support.tier": z.enum(["community", "standard", "priority", "dedicated"]),
  "handover.included": z.boolean(),
  "lane.priority": z.boolean(),
});

export type EntitlementsV1 = z.infer<typeof EntitlementsV1>;
export const Entitlements = EntitlementsV1;
export type Entitlements = EntitlementsV1;
export type EntitlementCapability = Exclude<keyof Entitlements, "schemaVersion">;

const LegacyEntitlements = z.object({
  activeVentures: z.number().int().nonnegative(),
  autonomy: z.array(z.enum(["supervised", "guided", "autonomous"])).min(1),
  weeklyCredits: z.number().int().nonnegative(),
  modelTier: z.enum(["cheap", "standard", "deep"]),
  handoverIncluded: z.boolean(),
  priorityExecution: z.boolean().optional(),
});

const AUTONOMY_ORDER = ["supervised", "guided", "autonomous"] as const;

/**
 * Migrates persisted entitlement JSON to the current additive schema.
 * Add one explicit branch per future schemaVersion; never reinterpret an old
 * subscription based on its marketing plan name.
 */
export function migrateEntitlements(value: unknown): Entitlements {
  const current = Entitlements.safeParse(value);
  if (current.success) return current.data;

  const legacy = LegacyEntitlements.safeParse(value);
  if (legacy.success) {
    const autonomy = [...legacy.data.autonomy].sort(
      (left, right) => AUTONOMY_ORDER.indexOf(left) - AUTONOMY_ORDER.indexOf(right),
    ).at(-1) ?? "supervised";
    return Entitlements.parse({
      schemaVersion: ENTITLEMENT_SCHEMA_VERSION,
      "ventures.max": legacy.data.activeVentures,
      "autonomy.max": autonomy,
      "credits.weekly": legacy.data.weeklyCredits,
      "model.tier.max": legacy.data.modelTier,
      "playbooks.allowed": ["physical-shopify", "digital-product", "local-service"],
      "scopes.granted": [],
      "support.tier": "community",
      "handover.included": legacy.data.handoverIncluded,
      "lane.priority": legacy.data.priorityExecution ?? false,
    });
  }

  throw new Error(`Unsupported entitlement schema: ${current.error.message}`);
}

