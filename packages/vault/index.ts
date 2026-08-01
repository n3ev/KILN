import { randomUUID } from "node:crypto";
import { CredentialUnavailable } from "@kiln/contracts";
import { asServiceRole, getDb, rowsOf, type Database } from "@kiln/db";
import { logger } from "@kiln/observability";
import { sql } from "drizzle-orm";
import { assertAccountId, seal, unseal } from "./crypto.js";

/**
 * Credential encryption and leasing.
 *
 * Public callers can seal or store a credential, request a short-lived lease,
 * and use that lease through `withCredential`. Plaintext is never returned by
 * the package API. The callback is the decryption boundary used by an egress
 * signer; it must not log, persist, or pass the value to a model.
 */

export type RotationPolicy = "supported" | "reissue-only" | "manual";

const SCOPE = /^[a-z][a-z0-9.-]*(?::[a-z0-9*.-]+)*$/;

function normaliseScopes(scopes: readonly string[]): string[] {
  const unique = [...new Set(scopes)].sort();
  const invalid = unique.find((scope) => !SCOPE.test(scope));
  if (invalid) throw new Error(`Invalid credential scope "${invalid}".`);
  return unique;
}

function scopeArrayLiteral(scopes: readonly string[]): string {
  // normaliseScopes excludes every character with meaning in a Postgres array
  // literal, so this value remains data when passed as a bound parameter.
  return `{${scopes.join(",")}}`;
}

interface CredentialRecord {
  id: string;
  accountId: string;
  assetId: string;
  provider: string;
  assetStatus: string;
  connectionStatus: string | null;
  ciphertext: Uint8Array;
  dekWrapped: Uint8Array;
  nonce: Uint8Array;
  scopes: string[];
  rotationPolicy: RotationPolicy;
  expiresAt: string | null;
}

async function loadCredential(
  db: Database,
  credentialId: string,
  accountId: string,
): Promise<CredentialRecord | undefined> {
  return asServiceRole(db, async (tx) =>
    rowsOf<CredentialRecord>(
      await tx.execute(sql`
        SELECT c.id,
               v.account_id AS "accountId",
               a.id AS "assetId",
               a.provider,
               a.status::text AS "assetStatus",
               (
                 SELECT connection.status::text
                 FROM connections connection
                 WHERE connection.asset_id = a.id
                 ORDER BY connection.created_at DESC
                 LIMIT 1
               ) AS "connectionStatus",
               c.ciphertext,
               c.dek_wrapped AS "dekWrapped",
               c.nonce,
               c.scopes,
               c.rotation_policy AS "rotationPolicy",
               c.expires_at::text AS "expiresAt"
        FROM credentials c
        JOIN assets a ON a.id = c.asset_id
        JOIN ventures v ON v.id = a.venture_id
        WHERE c.id = ${credentialId} AND v.account_id = ${accountId}
        LIMIT 1
      `),
    )[0],
  );
}

function assertUsable(record: CredentialRecord, provider: string): void {
  if (record.provider !== provider) {
    throw new CredentialUnavailable(provider, record.assetId, "credential belongs to a different provider");
  }
  if (record.assetStatus !== "active") {
    throw new CredentialUnavailable(provider, record.assetId, `asset is ${record.assetStatus}`);
  }
  if (record.connectionStatus === "expired" || record.connectionStatus === "revoked") {
    throw new CredentialUnavailable(provider, record.assetId, `connection is ${record.connectionStatus}`);
  }
  if (record.expiresAt !== null && new Date(record.expiresAt).getTime() <= Date.now()) {
    throw new CredentialUnavailable(provider, record.assetId, "credential has expired");
  }
}

export interface StoreCredentialRequest {
  readonly accountId: string;
  readonly assetId: string;
  readonly provider: string;
  readonly plaintext: string;
  readonly scopes: readonly string[];
  readonly rotationPolicy?: RotationPolicy;
  readonly expiresAt?: Date;
}

/** Encrypts and persists a credential after proving asset ownership. */
export async function storeCredential(request: StoreCredentialRequest): Promise<{ credentialId: string }> {
  assertAccountId(request.accountId);
  const scopes = normaliseScopes(request.scopes);
  const db = await getDb();
  const asset = await asServiceRole(db, async (tx) =>
    rowsOf<{ id: string; provider: string }>(
      await tx.execute(sql`
        SELECT a.id, a.provider
        FROM assets a
        JOIN ventures v ON v.id = a.venture_id
        WHERE a.id = ${request.assetId} AND v.account_id = ${request.accountId}
        LIMIT 1
      `),
    )[0],
  );
  if (!asset || asset.provider !== request.provider) {
    throw new CredentialUnavailable(request.provider, request.assetId, "asset does not belong to this account/provider");
  }

  const sealed = await seal(request.plaintext, request.accountId);
  const credentialId = randomUUID();
  const expiresAt = request.expiresAt?.toISOString() ?? null;
  await asServiceRole(db, async (tx) => {
    await tx.execute(sql`
      INSERT INTO credentials
        (id, asset_id, ciphertext, dek_wrapped, nonce, scopes, rotation_policy, expires_at)
      VALUES
        (${credentialId}, ${request.assetId}, ${Buffer.from(sealed.ciphertext)},
         ${Buffer.from(sealed.dekWrapped)}, ${Buffer.from(sealed.nonce)},
         ${scopeArrayLiteral(scopes)}::text[], ${request.rotationPolicy ?? "manual"},
         ${expiresAt}::timestamptz)
    `);
  });
  return { credentialId };
}

export interface CredentialHandle {
  /** Opaque random lease row id; it never embeds the credential id. */
  readonly id: string;
  readonly provider: string;
  readonly scopes: readonly string[];
  readonly expiresAt: string;
}

export interface LeaseRequest {
  readonly credentialId: string;
  readonly accountId: string;
  readonly provider: string;
  readonly scopes: readonly string[];
  readonly ttlSeconds: number;
  readonly runId?: string;
  readonly toolId: string;
  readonly purpose: string;
}

export const MAX_LEASE_TTL_SECONDS = 300;

/** Issues a persisted, scoped, short-lived handle rather than a secret. */
export async function lease(request: LeaseRequest): Promise<CredentialHandle> {
  if (!Number.isInteger(request.ttlSeconds) || request.ttlSeconds < 1 || request.ttlSeconds > MAX_LEASE_TTL_SECONDS) {
    throw new CredentialUnavailable(request.provider, undefined, `lease TTL must be 1-${MAX_LEASE_TTL_SECONDS} seconds`);
  }
  if (request.toolId.trim().length === 0 || request.purpose.trim().length === 0) {
    throw new CredentialUnavailable(request.provider, undefined, "lease requires a tool id and purpose");
  }
  const requestedScopes = normaliseScopes(request.scopes);
  const db = await getDb();
  const record = await loadCredential(db, request.credentialId, request.accountId);
  if (!record) throw new CredentialUnavailable(request.provider, undefined, "credential not found for this account");
  assertUsable(record, request.provider);

  const missing = requestedScopes.filter((scope) => !record.scopes.includes(scope));
  if (missing.length > 0) {
    throw new CredentialUnavailable(request.provider, record.assetId, `credential lacks scopes: ${missing.join(", ")}`);
  }

  if (request.runId !== undefined) {
    const run = await asServiceRole(db, async (tx) =>
      rowsOf<{ id: string }>(
        await tx.execute(sql`
          SELECT r.id
          FROM runs r
          JOIN ventures v ON v.id = r.venture_id
          WHERE r.id = ${request.runId} AND v.account_id = ${request.accountId}
          LIMIT 1
        `),
      )[0],
    );
    if (!run) throw new CredentialUnavailable(request.provider, record.assetId, "run does not belong to this account");
  }

  const requestedExpiry = Date.now() + request.ttlSeconds * 1_000;
  const credentialExpiry = record.expiresAt === null ? Number.POSITIVE_INFINITY : new Date(record.expiresAt).getTime();
  const expiresAt = new Date(Math.min(requestedExpiry, credentialExpiry)).toISOString();
  const leaseId = randomUUID();

  await asServiceRole(db, async (tx) => {
    await tx.execute(sql`
      INSERT INTO credential_leases
        (id, credential_id, run_id, tool_id, purpose, scopes, expires_at)
      VALUES
        (${leaseId}, ${record.id}, ${request.runId ?? null}, ${request.toolId}, ${request.purpose},
         ${scopeArrayLiteral(requestedScopes)}::text[], ${expiresAt}::timestamptz)
    `);
  });

  logger.info("credential leased", {
    leaseId,
    provider: request.provider,
    assetId: record.assetId,
    toolId: request.toolId,
    purpose: request.purpose,
    runId: request.runId,
    scopes: requestedScopes,
    expiresAt,
  });
  return { id: leaseId, provider: request.provider, scopes: requestedScopes, expiresAt };
}

interface LeaseRecord extends CredentialRecord {
  leaseId: string;
  leaseToolId: string;
  leaseScopes: string[];
  leaseExpiresAt: string;
}

async function loadLease(db: Database, leaseId: string, accountId: string): Promise<LeaseRecord | undefined> {
  return asServiceRole(db, async (tx) =>
    rowsOf<LeaseRecord>(
      await tx.execute(sql`
        SELECT l.id AS "leaseId",
               l.tool_id AS "leaseToolId",
               l.scopes AS "leaseScopes",
               l.expires_at::text AS "leaseExpiresAt",
               c.id,
               v.account_id AS "accountId",
               a.id AS "assetId",
               a.provider,
               a.status::text AS "assetStatus",
               (
                 SELECT connection.status::text
                 FROM connections connection
                 WHERE connection.asset_id = a.id
                 ORDER BY connection.created_at DESC
                 LIMIT 1
               ) AS "connectionStatus",
               c.ciphertext,
               c.dek_wrapped AS "dekWrapped",
               c.nonce,
               c.scopes,
               c.rotation_policy AS "rotationPolicy",
               c.expires_at::text AS "expiresAt"
        FROM credential_leases l
        JOIN credentials c ON c.id = l.credential_id
        JOIN assets a ON a.id = c.asset_id
        JOIN ventures v ON v.id = a.venture_id
        WHERE l.id = ${leaseId} AND v.account_id = ${accountId}
        LIMIT 1
      `),
    )[0],
  );
}

export interface UseCredentialRequest {
  readonly handle: CredentialHandle | string;
  readonly accountId: string;
  readonly provider: string;
  readonly toolId: string;
  readonly scopes: readonly string[];
}

/**
 * Resolves a lease only inside the supplied callback. This is the sole public
 * plaintext boundary and is intended for request signing in the egress layer.
 */
export async function withCredential<T>(
  request: UseCredentialRequest,
  use: (plaintext: string) => Promise<T>,
): Promise<T> {
  const leaseId = typeof request.handle === "string" ? request.handle : request.handle.id;
  const requestedScopes = normaliseScopes(request.scopes);
  const db = await getDb();
  const record = await loadLease(db, leaseId, request.accountId);
  if (!record) throw new CredentialUnavailable(request.provider, undefined, "lease not found for this account");
  assertUsable(record, request.provider);
  if (record.leaseToolId !== request.toolId) {
    throw new CredentialUnavailable(request.provider, record.assetId, "lease was issued to a different tool");
  }
  if (new Date(record.leaseExpiresAt).getTime() <= Date.now()) {
    throw new CredentialUnavailable(request.provider, record.assetId, "lease has expired");
  }
  const missing = requestedScopes.filter(
    (scope) => !record.leaseScopes.includes(scope) || !record.scopes.includes(scope),
  );
  if (missing.length > 0) {
    throw new CredentialUnavailable(request.provider, record.assetId, `lease lacks scopes: ${missing.join(", ")}`);
  }

  let plaintext = await unseal(
    { ciphertext: record.ciphertext, dekWrapped: record.dekWrapped, nonce: record.nonce },
    request.accountId,
    request.provider,
    record.assetId,
  );
  try {
    return await use(plaintext);
  } finally {
    // JavaScript strings cannot be reliably zeroed, but dropping the reference
    // immediately keeps the lifetime bounded to this callback.
    plaintext = "";
  }
}

/** Revokes a lease without deleting its audit row. */
export async function revokeLease(leaseId: string, accountId: string): Promise<boolean> {
  const db = await getDb();
  const record = await loadLease(db, leaseId, accountId);
  if (!record) return false;
  await asServiceRole(db, async (tx) => {
    await tx.execute(sql`UPDATE credential_leases SET expires_at = now() WHERE id = ${leaseId}`);
  });
  logger.info("credential lease revoked", { leaseId, assetId: record.assetId });
  return true;
}

/**
 * Rotates persisted ciphertext transactionally after the replacement passes a
 * provider verification read. Existing leases are expired in the same commit.
 */
export async function rotate(args: {
  credentialId: string;
  provider: string;
  accountId: string;
  issue: () => Promise<string>;
  verify: (secret: string) => Promise<boolean>;
}): Promise<{ rotated: boolean; reason?: string }> {
  const db = await getDb();
  const current = await loadCredential(db, args.credentialId, args.accountId);
  if (!current) throw new CredentialUnavailable(args.provider, undefined, "credential not found for this account");
  assertUsable(current, args.provider);
  if (current.rotationPolicy === "manual") {
    return { rotated: false, reason: "provider requires manual rotation" };
  }

  const next = await args.issue();
  if (!(await args.verify(next))) {
    logger.warn("credential rotation failed verification; keeping the old credential", {
      credentialId: args.credentialId,
      provider: args.provider,
    });
    return { rotated: false, reason: "verification of the new credential failed" };
  }

  const sealed = await seal(next, args.accountId);
  await asServiceRole(db, async (tx) => {
    await tx.execute(sql`
      UPDATE credentials
      SET ciphertext = ${Buffer.from(sealed.ciphertext)},
          dek_wrapped = ${Buffer.from(sealed.dekWrapped)},
          nonce = ${Buffer.from(sealed.nonce)},
          rotated_at = now()
      WHERE id = ${args.credentialId}
    `);
    await tx.execute(sql`UPDATE credential_leases SET expires_at = now() WHERE credential_id = ${args.credentialId}`);
  });
  logger.info("credential rotated", { credentialId: args.credentialId, provider: args.provider });
  return { rotated: true };
}
