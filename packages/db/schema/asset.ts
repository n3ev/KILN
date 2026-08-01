import { relations } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { assetStatusEnum, bytea, connectionStatus, createdAt, ownershipMode } from "./_shared.js";
import { ventures } from "./venture.js";

/** An externally-owned resource KILN provisioned on the customer's behalf. */
export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ventureId: uuid("venture_id")
      .notNull()
      .references(() => ventures.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    provider: text("provider").notNull(),
    externalId: text("external_id"),
    displayName: text("display_name").notNull(),
    ownershipMode: ownershipMode("ownership_mode").notNull().default("managed"),
    status: assetStatusEnum("status").notNull().default("provisioning"),
    metadata: jsonb("metadata").notNull().default({}),
    provisionedAt: timestamp("provisioned_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("assets_venture_idx").on(t.ventureId),
    index("assets_kind_idx").on(t.kind),
    index("assets_provider_external_idx").on(t.provider, t.externalId),
  ],
);

/**
 * Encrypted credentials.
 *
 * `ciphertext` is never selected outside packages/vault — enforced by a lint
 * rule, not by hope. Envelope encryption: the row holds a wrapped Data
 * Encryption Key; the Key Encryption Key lives in a KMS (or, in local dev, a
 * libsodium key file under .kiln/keys). Plaintext exists only inside the tool
 * execution boundary and never enters a log, a prompt, or an API response.
 */
export const credentials = pgTable(
  "credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    ciphertext: bytea("ciphertext").notNull(),
    dekWrapped: bytea("dek_wrapped").notNull(),
    nonce: bytea("nonce").notNull(),
    scopes: text("scopes").array().notNull().default([]),
    /** Declared by the connector: supported | reissue-only | manual. */
    rotationPolicy: text("rotation_policy").notNull().default("manual"),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("credentials_asset_idx").on(t.assetId), index("credentials_expires_idx").on(t.expiresAt)],
);

/** Every lease of a credential, for audit. Records purpose, never the secret. */
export const credentialLeases = pgTable(
  "credential_leases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    credentialId: uuid("credential_id")
      .notNull()
      .references(() => credentials.id, { onDelete: "cascade" }),
    runId: uuid("run_id"),
    toolId: text("tool_id").notNull(),
    purpose: text("purpose").notNull(),
    scopes: text("scopes").array().notNull().default([]),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("credential_leases_credential_idx").on(t.credentialId), index("credential_leases_run_idx").on(t.runId)],
);

export const connections = pgTable(
  "connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ventureId: uuid("venture_id")
      .notNull()
      .references(() => ventures.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
    status: connectionStatus("status").notNull().default("healthy"),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    syncCursor: jsonb("sync_cursor").notNull().default({}),
    /** Staleness, auth expiry, webhook signature failures. Drives the banner. */
    health: jsonb("health").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index("connections_venture_idx").on(t.ventureId),
    index("connections_status_idx").on(t.status),
  ],
);

export const assetsRelations = relations(assets, ({ one, many }) => ({
  venture: one(ventures, { fields: [assets.ventureId], references: [ventures.id] }),
  credentials: many(credentials),
}));
