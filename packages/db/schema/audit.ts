import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./_shared.js";
import { accounts } from "./identity.js";
import { artifacts } from "./artifact.js";
import { ventures } from "./venture.js";

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "cascade" }),
    /** "user:<uuid>", "agent:<id>", "system", "tool:<id>". */
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_log_account_idx").on(t.accountId),
    index("audit_log_subject_idx").on(t.subjectType, t.subjectId),
    index("audit_log_created_idx").on(t.createdAt),
  ],
);

/**
 * Escrowed break-glass packets — CLAUDE.md §12.2.5.
 *
 * KILN stores the ciphertext and the customer's *public* key only. If KILN
 * disappears, the customer can still decrypt the packet with the private half
 * they generated at onboarding and never shared.
 */
export const breakGlassPackets = pgTable(
  "break_glass_packets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ventureId: uuid("venture_id")
      .notNull()
      .references(() => ventures.id, { onDelete: "cascade" }),
    artifactId: uuid("artifact_id").references(() => artifacts.id, { onDelete: "set null" }),
    recipientPublicKey: text("recipient_public_key").notNull(),
    recipientKeyFingerprintSha256: text("recipient_key_fingerprint_sha256"),
    algorithm: text("algorithm").notNull().default("x25519-hkdf-sha256+a256gcm"),
    /** Recipient-only envelope. Never place the plaintext packet in this row. */
    envelope: jsonb("envelope"),
    storageKey: text("storage_key").notNull(),
    status: text("status").notNull().default("assembled"),
    idempotencyKey: text("idempotency_key"),
    signedUrl: text("signed_url"),
    urlExpiresAt: timestamp("url_expires_at", { withTimezone: true }),
    packetChecksumSha256: text("packet_checksum_sha256").notNull(),
    emailedTo: text("emailed_to"),
    createdAt: createdAt(),
  },
  (t) => [
    index("break_glass_venture_idx").on(t.ventureId),
    index("break_glass_artifact_idx").on(t.artifactId),
    index("break_glass_fingerprint_idx").on(t.recipientKeyFingerprintSha256),
    uniqueIndex("break_glass_venture_idempotency_idx").on(t.ventureId, t.idempotencyKey),
  ],
);

/**
 * The durable job queue used when Inngest is not configured — a Postgres
 * `FOR UPDATE SKIP LOCKED` queue. CLAUDE.md §4 requires the jobs abstraction
 * be swappable for exactly this, so it ships as a first-class table rather
 * than as a fallback bolted on later.
 */
export const jobQueue = pgTable(
  "job_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    payload: jsonb("payload").notNull(),
    /** Deduplicates enqueues, which is what makes step functions idempotent. */
    idempotencyKey: text("idempotency_key"),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    lastError: jsonb("last_error"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("job_queue_claim_idx").on(t.status, t.runAfter),
    index("job_queue_name_idx").on(t.name),
    uniqueIndex("job_queue_idempotency_idx").on(t.name, t.idempotencyKey),
  ],
);

/**
 * Events a workflow is sleeping on (`waitForEvent`). A human approval that
 * takes three days must survive deploys, so the wait is a row, not a promise.
 */
export const eventWaiters = pgTable(
  "event_waiters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull(),
    eventName: text("event_name").notNull(),
    matchKey: text("match_key"),
    resolvedPayload: jsonb("resolved_payload"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("event_waiters_lookup_idx").on(t.eventName, t.matchKey),
    index("event_waiters_run_idx").on(t.runId),
  ],
);
