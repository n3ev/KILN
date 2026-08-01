import {
  bigint,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt } from "./_shared.js";
import { ventures } from "./venture.js";

/**
 * The mirror layer — CLAUDE.md §13. The customer sees their business through
 * KILN, so these tables have to be faithful, not merely present.
 *
 * `dimensionsHash` exists because Postgres cannot build a unique index over a
 * jsonb column directly in a way that treats key order as insignificant. The
 * ingestion path computes a stable hash of the sorted dimension pairs, which
 * makes upsert-on-conflict work and makes a replayed webhook a no-op.
 */
export const metricSnapshots = pgTable(
  "metric_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ventureId: uuid("venture_id")
      .notNull()
      .references(() => ventures.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    metricKey: text("metric_key").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    value: numeric("value", { precision: 20, scale: 6 }).notNull(),
    dimensions: jsonb("dimensions").notNull().default({}),
    dimensionsHash: text("dimensions_hash").notNull().default(""),
    currency: text("currency"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("metric_snapshots_unique_idx").on(
      t.ventureId,
      t.provider,
      t.metricKey,
      t.ts,
      t.dimensionsHash,
    ),
    index("metric_snapshots_venture_key_ts_idx").on(t.ventureId, t.metricKey, t.ts),
  ],
);

export const ordersMirror = pgTable(
  "orders_mirror",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ventureId: uuid("venture_id")
      .notNull()
      .references(() => ventures.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    placedAt: timestamp("placed_at", { withTimezone: true }).notNull(),
    grossCents: bigint("gross_cents", { mode: "number" }).notNull(),
    netCents: bigint("net_cents", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    items: jsonb("items").notNull().default([]),
    /** Pseudonymous reference. KILN mirrors orders, not customer PII. */
    customerRef: text("customer_ref"),
    status: text("status").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("orders_mirror_provider_external_idx").on(t.ventureId, t.provider, t.externalId),
    index("orders_mirror_venture_placed_idx").on(t.ventureId, t.placedAt),
  ],
);

/**
 * Webhook replay protection. A provider that redelivers an event — and they all
 * do — must not double-count revenue. Polling reconciliation repairs the
 * opposite failure, gaps from webhooks that never arrived.
 */
export const webhookReceipts = pgTable(
  "webhook_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ventureId: uuid("venture_id").references(() => ventures.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    externalEventId: text("external_event_id").notNull(),
    topic: text("topic").notNull(),
    signatureVerified: jsonb("signature_verified").notNull().default({}),
    /** Raw payload goes to object storage; this is the pointer, for replay. */
    rawStorageKey: text("raw_storage_key"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("webhook_receipts_provider_event_idx").on(t.provider, t.externalEventId),
    index("webhook_receipts_venture_idx").on(t.ventureId),
  ],
);

/** Materialised daily rollups so the dashboard never scans raw snapshots. */
export const dailyRollups = pgTable(
  "daily_rollups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ventureId: uuid("venture_id")
      .notNull()
      .references(() => ventures.id, { onDelete: "cascade" }),
    day: timestamp("day", { withTimezone: true }).notNull(),
    metricKey: text("metric_key").notNull(),
    value: numeric("value", { precision: 20, scale: 6 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("daily_rollups_unique_idx").on(t.ventureId, t.day, t.metricKey)],
);
