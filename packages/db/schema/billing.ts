import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { costCategory, createdAt, creditKind } from "./_shared.js";
import { accounts } from "./identity.js";
import { runs } from "./run.js";

export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** Billed weekly. Monthly and annual are discounted derivations. */
    priceWeeklyCents: integer("price_weekly_cents").notNull(),
    entitlements: jsonb("entitlements").notNull().default({}),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("plans_name_idx").on(t.name)],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id),
    stripeSubscriptionId: text("stripe_subscription_id"),
    status: text("status").notNull().default("active"),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAt: timestamp("cancel_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("subscriptions_account_idx").on(t.accountId),
    uniqueIndex("subscriptions_stripe_idx").on(t.stripeSubscriptionId),
  ],
);

/**
 * Stripe delivery inbox. The provider event id is the primary key, so retries
 * are recorded once and dispatched to the durable queue idempotently.
 */
export const stripeEvents = pgTable(
  "stripe_events",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    livemode: boolean("livemode").notNull().default(false),
    status: text("status").notNull().default("received"),
    lastError: jsonb("last_error"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("stripe_events_status_idx").on(t.status, t.createdAt)],
);

/**
 * Build credits. Distinct from cost_ledger: credits are what the customer
 * bought, cost is what KILN spent. They never net against each other, because
 * external spend (domains, ad budget) must never be paid from build credits —
 * that is the rule that keeps the margin model legible. See CLAUDE.md §9.3.
 */
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    deltaMicros: bigint("delta_micros", { mode: "number" }).notNull(),
    kind: creditKind("kind").notNull(),
    reason: text("reason").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("credit_ledger_account_idx").on(t.accountId), index("credit_ledger_run_idx").on(t.runId)],
);

/** Every micro KILN spent, attributed to a run. Feeds per-run margin. */
export const costLedger = pgTable(
  "cost_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    category: costCategory("category").notNull(),
    /** The agent_invocation, tool_call, or external reference this came from. */
    refId: text("ref_id"),
    amountMicros: bigint("amount_micros", { mode: "number" }).notNull(),
    vendor: text("vendor").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("cost_ledger_run_idx").on(t.runId),
    index("cost_ledger_category_idx").on(t.category),
    index("cost_ledger_created_idx").on(t.createdAt),
  ],
);
