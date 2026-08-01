import { z } from "zod";

/**
 * Capability scopes.
 *
 * A scope is the unit of permission between a run and the outside world. Runs
 * receive a GrantSet at start, computed as:
 *
 *   playbook.requiredScopes  ∩  plan.entitlements  ∩  customer connection state
 *
 * A tool declares the scopes it needs; the invocation pipeline (CLAUDE.md §9.2
 * step 2) refuses the call if any are missing. Scopes are deliberately coarse
 * enough for a human to reason about on an approval screen and fine enough
 * that "read your orders" never implies "issue refunds".
 */
export const Scope = z.enum([
  // Research and public data
  "research:read",

  // Brand and identity
  "identity:read", // availability lookups
  "identity:register", // buys things — always paired with a spend authorisation

  // Design generation
  "design:generate",

  // Commerce surfaces
  "commerce:read",
  "commerce:write",
  "commerce:publish",
  "commerce:transfer",

  // Payments
  "payments:read",
  "payments:write",
  "payments:refund",

  // Supply chain
  "supply:read",
  "supply:order",

  // Sites and DNS
  "site:build",
  "site:deploy",
  "dns:write",

  // Content
  "content:write",

  // Communications
  "comms:configure",
  "comms:send",

  // Scheduling / booking
  "booking:configure",

  // Analytics
  "analytics:read",
  "analytics:write",

  // Compliance
  "compliance:screen",

  // Money movement outside the platform (ads, registrars, samples)
  "spend:external",

  // Internal run mechanics — always granted
  "run:artifacts",
  "run:checkpoints",
  "run:notify",
]);
export type Scope = z.infer<typeof Scope>;

export const GrantSet = z.object({
  scopes: z.array(Scope).readonly(),
  /**
   * Why each scope was granted — shown on the run's permission screen.
   * Modelled as a list rather than a partial record so that a scope granted
   * twice for different reasons keeps both reasons legible to the customer.
   */
  rationale: z.array(z.object({ scope: Scope, reason: z.string().min(1) })).default([]),
});
export type GrantSet = z.infer<typeof GrantSet>;

export function hasScopes(granted: readonly Scope[], required: readonly Scope[]): boolean {
  return required.every((s) => granted.includes(s));
}

export function missingScopes(granted: readonly Scope[], required: readonly Scope[]): Scope[] {
  return required.filter((s) => !granted.includes(s));
}

/** Scopes every run gets; they cover run bookkeeping, never the outside world. */
export const ALWAYS_GRANTED: readonly Scope[] = ["run:artifacts", "run:checkpoints", "run:notify"];

/** Scopes that can move real money and therefore always need authorisation. */
export const SPENDING_SCOPES: readonly Scope[] = ["identity:register", "supply:order", "spend:external"];
