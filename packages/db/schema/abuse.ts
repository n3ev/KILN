import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { abuseReviewStatus, createdAt } from "./_shared.js";
import { accounts, users } from "./identity.js";
import { runs } from "./run.js";
import { ventures } from "./venture.js";

/** Durable operator queue for restricted, licence-required and age-gated ideas. */
export const abuseReviews = pgTable(
  "abuse_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    ventureId: uuid("venture_id").notNull().references(() => ventures.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    reason: text("reason").notNull(),
    status: abuseReviewStatus("status").notNull().default("pending"),
    evidence: jsonb("evidence").notNull().default({}),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    decisionNote: text("decision_note"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("abuse_reviews_run_category_idx").on(table.runId, table.category),
    index("abuse_reviews_account_status_idx").on(table.accountId, table.status),
    index("abuse_reviews_created_idx").on(table.createdAt),
  ],
);
