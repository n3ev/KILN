import { customType, pgEnum, timestamp } from "drizzle-orm/pg-core";

/**
 * Shared column helpers and enums.
 *
 * Two conventions worth stating once:
 *
 * 1. Money. Ledger and budget columns are integer **micros** (millionths of a
 *    currency unit) stored as bigint, because integer tops out at ~$2,147 in
 *    micros. Columns the spec names `_cents` stay cents-as-integer so the
 *    Stripe boundary needs no conversion. Display formatting happens once, in
 *    packages/ui — never here, never in a query.
 *
 * 2. Time. Everything is `timestamptz`. A naive timestamp in a system that
 *    reconciles Shopify webhooks against a Fly worker in another region is a
 *    bug waiting for a clock change.
 */

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/** Micros: signed, because ledger deltas go both ways. */
export const micros = (name: string) => ({
  bigintMode: "number" as const,
  name,
});

export const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const accountStatus = pgEnum("account_status", ["trialing", "active", "past_due", "suspended", "closed"]);
export const kycStatus = pgEnum("kyc_status", ["unverified", "pending", "verified", "rejected"]);
export const abuseReviewStatus = pgEnum("abuse_review_status", ["pending", "cleared", "blocked"]);
export const userRole = pgEnum("user_role", ["owner", "member", "admin"]);
export const autonomyLevel = pgEnum("autonomy_level", ["supervised", "guided", "autonomous"]);
export const archetype = pgEnum("archetype", ["physical", "digital", "service"]);
export const ventureStatus = pgEnum("venture_status", [
  "draft",
  "building",
  "live",
  "paused",
  "archived",
  "transferred",
]);
export const ownershipMode = pgEnum("ownership_mode", ["managed", "delegated", "transferred"]);
export const runStatus = pgEnum("run_status", [
  "queued",
  "running",
  "waiting_on_checkpoint",
  "paused",
  "succeeded",
  "failed",
  "cancelled",
]);
export const phaseStatus = pgEnum("phase_status", [
  "pending",
  "running",
  "blocked",
  "succeeded",
  "failed",
  "skipped",
]);
export const taskStatus = pgEnum("task_status", ["pending", "running", "succeeded", "failed", "abandoned"]);
export const eventActor = pgEnum("event_actor", ["agent", "tool", "human", "system"]);
export const artifactStatus = pgEnum("artifact_status", [
  "draft",
  "in_review",
  "accepted",
  "rejected",
  "superseded",
]);
export const checkpointStatus = pgEnum("checkpoint_status", [
  "pending",
  "approved",
  "rejected",
  "expired",
  "auto",
]);
export const invocationStatus = pgEnum("invocation_status", ["running", "succeeded", "failed"]);
export const toolCallStatus = pgEnum("tool_call_status", ["running", "succeeded", "failed", "refused"]);
export const budgetCategory = pgEnum("budget_category", ["model", "image", "tool", "external"]);
export const costCategory = pgEnum("cost_category", ["model", "image", "tool", "external"]);
export const creditKind = pgEnum("credit_kind", ["grant", "spend", "refund"]);
export const connectionStatus = pgEnum("connection_status", ["healthy", "degraded", "expired", "revoked"]);
export const assetStatusEnum = pgEnum("asset_status", [
  "provisioning",
  "active",
  "suspended",
  "transferring",
  "released",
  "failed",
]);
