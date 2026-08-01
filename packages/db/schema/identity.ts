import { relations } from "drizzle-orm";
import { bigint, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { accountStatus, autonomyLevel, createdAt, kycStatus, userRole } from "./_shared.js";

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    planId: uuid("plan_id"),
    status: accountStatus("status").notNull().default("trialing"),
    /** Seeds a new run's autonomy; runs.autonomy is operative once started. */
    autonomyDefault: autonomyLevel("autonomy_default").notNull().default("guided"),
    stripeCustomerId: text("stripe_customer_id"),
    budgetWeeklyCents: integer("budget_weekly_cents").notNull().default(0),
    /** Live publish tools fail closed until the paying account is verified. */
    kycStatus: kycStatus("kyc_status").notNull().default("unverified"),
    kycVerifiedAt: timestamp("kyc_verified_at", { withTimezone: true }),
    /**
     * Public half of the customer's break-glass keypair, registered at
     * onboarding. KILN never sees the private half, and therefore cannot read
     * the escrow packets it stores. See CLAUDE.md §12.2.5.
     */
    breakGlassPublicKey: text("break_glass_public_key"),
    breakGlassKeyAlgorithm: text("break_glass_key_algorithm"),
    breakGlassKeyFingerprintSha256: text("break_glass_key_fingerprint_sha256"),
    breakGlassKeyRegisteredAt: timestamp("break_glass_key_registered_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("accounts_status_idx").on(t.status),
    uniqueIndex("accounts_stripe_customer_idx").on(t.stripeCustomerId),
  ],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name"),
    role: userRole("role").notNull().default("member"),
    /** Supabase auth uid. Null for seeded/offline users. */
    authUid: uuid("auth_uid"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("users_email_idx").on(t.email),
    uniqueIndex("users_auth_uid_idx").on(t.authUid),
    index("users_account_idx").on(t.accountId),
  ],
);

/**
 * Opaque bearer tokens for the MCP surface. Stored hashed — the plaintext is
 * shown once at issue time and never again. Prompt 1 restricts these to
 * sandbox, read-only tools; see CLAUDE.md §9.4.
 */
export const mcpTokens = pgTable(
  "mcp_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    /** sha256 of the 32-byte random token. Never the token itself. */
    tokenHash: text("token_hash").notNull(),
    scopes: text("scopes").array().notNull().default([]),
    rateLimitPerMinute: integer("rate_limit_per_minute").notNull().default(60),
    lastUsedAt: bigint("last_used_at", { mode: "number" }),
    expiresAt: bigint("expires_at", { mode: "number" }),
    revokedAt: bigint("revoked_at", { mode: "number" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("mcp_tokens_hash_idx").on(t.tokenHash),
    index("mcp_tokens_account_idx").on(t.accountId),
  ],
);

export const accountsRelations = relations(accounts, ({ many }) => ({
  users: many(users),
  mcpTokens: many(mcpTokens),
}));

export const usersRelations = relations(users, ({ one }) => ({
  account: one(accounts, { fields: [users.accountId], references: [accounts.id] }),
}));
