import { relations } from "drizzle-orm";
import { index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { archetype, createdAt, ownershipMode, ventureStatus } from "./_shared.js";
import { accounts } from "./identity.js";

export const ventures = pgTable(
  "ventures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    archetype: archetype("archetype").notNull(),
    status: ventureStatus("status").notNull().default("draft"),
    ownershipMode: ownershipMode("ownership_mode").notNull().default("managed"),
    /** VentureBrief, validated against @kiln/contracts on read and write. */
    brief: jsonb("brief").notNull(),
    primaryDomain: text("primary_domain"),
    createdAt: createdAt(),
  },
  (t) => [
    index("ventures_account_idx").on(t.accountId),
    index("ventures_status_idx").on(t.status),
  ],
);

export const venturesRelations = relations(ventures, ({ one }) => ({
  account: one(accounts, { fields: [ventures.accountId], references: [accounts.id] }),
}));
