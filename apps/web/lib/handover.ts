import { createHash, randomUUID } from "node:crypto";
import {
  BreakGlassPayload,
  BreakGlassPublicKeyRegistration,
  BreakGlassPublicKeyRequest,
  type BreakGlassPublicKeyRegistration as KeyRegistration,
} from "@kiln/contracts";
import {
  BREAK_GLASS_ALGORITHM,
  InvalidBreakGlassKey,
  assembleHandoverPacket,
  encryptBreakGlassPayload,
  normaliseCustomerPublicKey,
  publicKeyFingerprintSha256,
  type HandoverAssetSnapshot,
} from "@kiln/connectors";
import { rowsOf, type Database } from "@kiln/db";
import { contentHash } from "@kiln/tools";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withSessionAccount } from "./session";

const Json = z.unknown().transform((value, ctx): unknown => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalid persisted JSON" });
    return z.NEVER;
  }
});
const DateIso = z.union([z.date(), z.string(), z.number()]).transform((value) => new Date(value).toISOString());

const AccountKeyRow = z.object({
  break_glass_public_key: z.string().nullable(),
  break_glass_key_algorithm: z.string().nullable(),
  break_glass_key_fingerprint_sha256: z.string().nullable(),
  break_glass_key_registered_at: z.union([z.date(), z.string(), z.number()]).nullable(),
});
const VentureRow = z.object({
  id: z.string().uuid(), name: z.string(), status: z.string(),
  ownership_mode: z.enum(["managed", "delegated", "transferred"]), brief: Json,
});
const AssetRow = z.object({
  id: z.string().uuid(), venture_id: z.string().uuid(), kind: z.string(), provider: z.string(),
  external_id: z.string().nullable(), display_name: z.string(),
  ownership_mode: z.enum(["managed", "delegated", "transferred"]),
  status: z.enum(["provisioning", "active", "suspended", "transferring", "released", "failed"]),
});
const PacketRow = z.object({
  id: z.string().uuid(), venture_id: z.string().uuid(), artifact_id: z.string().uuid().nullable(),
  recipient_key_fingerprint_sha256: z.string().nullable(), status: z.string(), created_at: DateIso,
});

export interface HandoverSummaryAsset {
  id: string;
  kind: string;
  provider: string;
  displayName: string;
  externalId?: string;
  ownershipMode: "managed" | "delegated" | "transferred";
  status: string;
}
export interface HandoverSummaryVenture {
  id: string;
  name: string;
  status: string;
  ownershipMode: "managed" | "delegated" | "transferred";
  assets: HandoverSummaryAsset[];
  latestPacket?: { id: string; artifactId?: string; keyFingerprint: string; status: string; createdAt: string };
}
export interface HandoverSummary {
  key: { registered: boolean; algorithm?: string; fingerprint?: string; registeredAt?: string };
  ventures: HandoverSummaryVenture[];
}

function requireOwner(role: string): void {
  if (role !== "owner") throw new HandoverCommandError("owner_required", "Only the account owner can manage break-glass custody.", 403);
}

export class HandoverCommandError extends Error {
  constructor(
    readonly code: "owner_required" | "key_required" | "no_assets" | "venture_not_found" | "run_not_found" | "invalid_key" | "already_transferred",
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HandoverCommandError";
  }
}

async function summaryFrom(tx: Database, accountId: string): Promise<HandoverSummary> {
  const key = AccountKeyRow.parse(rowsOf<unknown>(await tx.execute(sql`
    SELECT break_glass_public_key, break_glass_key_algorithm,
      break_glass_key_fingerprint_sha256, break_glass_key_registered_at
    FROM accounts WHERE id = ${accountId}
  `))[0]);
  const ventures = rowsOf<unknown>(await tx.execute(sql`
    SELECT id, name, status, ownership_mode, brief FROM ventures
    WHERE account_id = ${accountId} ORDER BY created_at DESC
  `)).map((row) => VentureRow.parse(row));
  const assets = rowsOf<unknown>(await tx.execute(sql`
    SELECT a.id, a.venture_id, a.kind, a.provider, a.external_id, a.display_name,
      a.ownership_mode, a.status
    FROM assets a JOIN ventures v ON v.id = a.venture_id
    WHERE v.account_id = ${accountId} ORDER BY a.display_name
  `)).map((row) => AssetRow.parse(row));
  const packets = rowsOf<unknown>(await tx.execute(sql`
    SELECT DISTINCT ON (p.venture_id) p.id, p.venture_id, p.artifact_id,
      p.recipient_key_fingerprint_sha256, p.status, p.created_at
    FROM break_glass_packets p JOIN ventures v ON v.id = p.venture_id
    WHERE v.account_id = ${accountId}
    ORDER BY p.venture_id, p.created_at DESC
  `)).map((row) => PacketRow.parse(row));

  return {
    key: key.break_glass_public_key && key.break_glass_key_fingerprint_sha256
      ? {
          registered: true,
          algorithm: key.break_glass_key_algorithm ?? undefined,
          fingerprint: key.break_glass_key_fingerprint_sha256,
          registeredAt: key.break_glass_key_registered_at ? new Date(key.break_glass_key_registered_at).toISOString() : undefined,
        }
      : { registered: false },
    ventures: ventures.map((venture) => {
      const latest = packets.find((packet) => packet.venture_id === venture.id);
      return {
        id: venture.id,
        name: venture.name,
        status: venture.status,
        ownershipMode: venture.ownership_mode,
        assets: assets.filter((asset) => asset.venture_id === venture.id).map((asset) => ({
          id: asset.id,
          kind: asset.kind,
          provider: asset.provider,
          displayName: asset.display_name,
          ...(asset.external_id ? { externalId: asset.external_id } : {}),
          ownershipMode: asset.ownership_mode,
          status: asset.status,
        })),
        ...(latest ? { latestPacket: {
          id: latest.id,
          ...(latest.artifact_id ? { artifactId: latest.artifact_id } : {}),
          keyFingerprint: latest.recipient_key_fingerprint_sha256 ?? "legacy",
          status: latest.status,
          createdAt: latest.created_at,
        } } : {}),
      };
    }),
  };
}

export async function getHandoverSummary(): Promise<HandoverSummary> {
  return withSessionAccount((tx, session) => summaryFrom(tx, session.accountId));
}

export async function registerBreakGlassPublicKey(input: unknown): Promise<KeyRegistration> {
  const request = BreakGlassPublicKeyRequest.parse(input);
  let publicKey: string;
  let fingerprint: string;
  try {
    publicKey = normaliseCustomerPublicKey(request.publicKeyPem);
    fingerprint = publicKeyFingerprintSha256(publicKey);
  } catch (error) {
    if (error instanceof InvalidBreakGlassKey) throw new HandoverCommandError("invalid_key", error.message, 400);
    throw error;
  }
  const registeredAt = new Date().toISOString();
  return withSessionAccount(async (tx, session) => {
    requireOwner(session.role);
    const previous = AccountKeyRow.parse(rowsOf<unknown>(await tx.execute(sql`
      SELECT break_glass_public_key, break_glass_key_algorithm,
        break_glass_key_fingerprint_sha256, break_glass_key_registered_at
      FROM accounts WHERE id = ${session.accountId} FOR UPDATE
    `))[0]);
    await tx.execute(sql`
      UPDATE accounts SET break_glass_public_key = ${publicKey},
        break_glass_key_algorithm = ${BREAK_GLASS_ALGORITHM},
        break_glass_key_fingerprint_sha256 = ${fingerprint},
        break_glass_key_registered_at = ${registeredAt}
      WHERE id = ${session.accountId}
    `);
    await tx.execute(sql`
      INSERT INTO audit_log (account_id, actor, action, subject_type, subject_id, metadata)
      VALUES (${session.accountId}, ${`user:${session.userId}`},
        ${previous.break_glass_key_fingerprint_sha256 ? "handover.key_rotated" : "handover.key_registered"},
        'account', ${session.accountId}, ${JSON.stringify({ algorithm: BREAK_GLASS_ALGORITHM, fingerprintSha256: fingerprint })}::jsonb)
    `);
    return BreakGlassPublicKeyRegistration.parse({ algorithm: BREAK_GLASS_ALGORITHM, fingerprintSha256: fingerprint, registeredAt });
  });
}

const StartInput = z.object({ ventureId: z.string().uuid(), idempotencyKey: z.string().uuid() });
export type HandoverStartReceipt = { packetId: string; artifactId: string; targetCompletionAt: string; created: boolean };

function assetSnapshot(row: z.infer<typeof AssetRow>): HandoverAssetSnapshot {
  return {
    id: row.id,
    kind: row.kind as HandoverAssetSnapshot["kind"],
    provider: row.provider,
    ...(row.external_id ? { externalId: row.external_id } : {}),
    displayName: row.display_name,
    ownershipMode: row.ownership_mode,
    status: row.status,
  };
}

export async function startHandover(inputRaw: unknown): Promise<HandoverStartReceipt> {
  const input = StartInput.parse(inputRaw);
  return withSessionAccount(async (tx, session) => {
    requireOwner(session.role);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`handover:${session.accountId}:${input.ventureId}`}))`);
    const prior = rowsOf<{ id: string; artifact_id: string; content: unknown }>(await tx.execute(sql`
      SELECT p.id, p.artifact_id, a.content FROM break_glass_packets p
      JOIN ventures v ON v.id = p.venture_id LEFT JOIN artifacts a ON a.id = p.artifact_id
      WHERE p.venture_id = ${input.ventureId} AND p.idempotency_key = ${input.idempotencyKey}
        AND v.account_id = ${session.accountId} LIMIT 1
    `))[0];
    if (prior?.artifact_id) {
      const content = z.object({ targetCompletionAt: z.string() }).parse(typeof prior.content === "string" ? JSON.parse(prior.content) : prior.content);
      return { packetId: prior.id, artifactId: prior.artifact_id, targetCompletionAt: content.targetCompletionAt, created: false };
    }

    const key = AccountKeyRow.parse(rowsOf<unknown>(await tx.execute(sql`
      SELECT break_glass_public_key, break_glass_key_algorithm,
        break_glass_key_fingerprint_sha256, break_glass_key_registered_at
      FROM accounts WHERE id = ${session.accountId} FOR UPDATE
    `))[0]);
    if (!key.break_glass_public_key || !key.break_glass_key_fingerprint_sha256) {
      throw new HandoverCommandError("key_required", "Register a customer-controlled break-glass public key first.", 409);
    }
    const fingerprint = publicKeyFingerprintSha256(key.break_glass_public_key);
    if (fingerprint !== key.break_glass_key_fingerprint_sha256 || key.break_glass_key_algorithm !== BREAK_GLASS_ALGORITHM) {
      throw new HandoverCommandError("invalid_key", "The registered break-glass key metadata is inconsistent.", 409);
    }

    const ventureRaw = rowsOf<unknown>(await tx.execute(sql`
      SELECT id, name, status, ownership_mode, brief FROM ventures
      WHERE id = ${input.ventureId} AND account_id = ${session.accountId} FOR UPDATE
    `))[0];
    if (!ventureRaw) throw new HandoverCommandError("venture_not_found", "Venture not found.", 404);
    const venture = VentureRow.parse(ventureRaw);
    if (venture.ownership_mode === "transferred") {
      throw new HandoverCommandError("already_transferred", "This venture is already in customer custody.", 409);
    }
    const assets = rowsOf<unknown>(await tx.execute(sql`
      SELECT id, venture_id, kind, provider, external_id, display_name, ownership_mode, status
      FROM assets WHERE venture_id = ${venture.id} ORDER BY kind, id
    `)).map((row) => AssetRow.parse(row));
    if (assets.length === 0) throw new HandoverCommandError("no_assets", "This venture has no provisioned assets to hand over.", 409);
    const run = rowsOf<{ id: string }>(await tx.execute(sql`
      SELECT id FROM runs WHERE venture_id = ${venture.id} ORDER BY created_at DESC LIMIT 1
    `))[0];
    if (!run) throw new HandoverCommandError("run_not_found", "This venture has no run to attach the handover artifact to.", 409);

    const artifacts = rowsOf<Record<string, unknown>>(await tx.execute(sql`
      SELECT DISTINCT ON (type) id, type, version, content, content_hash, quality, created_at
      FROM artifacts WHERE venture_id = ${venture.id} ORDER BY type, version DESC
    `));
    const orders = rowsOf<Record<string, unknown>>(await tx.execute(sql`
      SELECT provider, external_id, placed_at, gross_cents, net_cents, currency, items, customer_ref, status
      FROM orders_mirror WHERE venture_id = ${venture.id} ORDER BY placed_at
    `));
    const metrics = rowsOf<Record<string, unknown>>(await tx.execute(sql`
      SELECT provider, metric_key, ts, value, dimensions, currency
      FROM metric_snapshots WHERE venture_id = ${venture.id} ORDER BY ts
    `));
    const exportData = {
      version: 1,
      venture: { id: venture.id, name: venture.name, status: venture.status, ownershipMode: venture.ownership_mode, brief: venture.brief },
      assets: assets.map(assetSnapshot),
      artifacts,
      orders,
      metrics,
    };
    const packetId = randomUUID();
    const artifactId = randomUUID();
    const generatedAt = new Date().toISOString();
    const storageKey = `break-glass://database/${packetId}`;
    const packet = assembleHandoverPacket({
      ventureId: venture.id,
      reason: "customer-requested",
      fromMode: venture.ownership_mode,
      assets: assets.map(assetSnapshot),
      export: {
        includes: ["orders", "customers", "products", "content", "brand-assets", "financials", "site-source", "policies"],
        storageKey: `${storageKey}#exportData`,
        sizeBytes: Buffer.byteLength(JSON.stringify(exportData), "utf8"),
        checksumSha256: contentHash(exportData),
        generatedAt,
      },
      disclosedOverrides: artifacts.filter((artifact) => {
        const quality = typeof artifact["quality"] === "string" ? JSON.parse(artifact["quality"] as string) as unknown : artifact["quality"];
        return z.object({ overridden: z.boolean().optional() }).safeParse(quality).data?.overridden === true;
      }).map((artifact) => `${String(artifact["type"])} v${String(artifact["version"])}`),
      startedAt: generatedAt,
    });
    const envelope = encryptBreakGlassPayload(BreakGlassPayload.parse({
      packet, exportData, recoveryMaterials: [], generatedAt,
    }), key.break_glass_public_key);
    const latestArtifact = rowsOf<{ id: string; version: number }>(await tx.execute(sql`
      SELECT id, version FROM artifacts WHERE run_id = ${run.id} AND type = 'handover_packet'
      ORDER BY version DESC LIMIT 1
    `))[0];
    const version = (latestArtifact?.version ?? 0) + 1;
    if (latestArtifact) await tx.execute(sql`UPDATE artifacts SET status = 'superseded' WHERE id = ${latestArtifact.id}`);
    await tx.execute(sql`
      INSERT INTO artifacts (id, venture_id, run_id, type, version, parent_id, status, content, content_hash, storage_key, quality, sources)
      VALUES (${artifactId}, ${venture.id}, ${run.id}, 'handover_packet', ${version}, ${latestArtifact?.id ?? null},
        'accepted', ${JSON.stringify(packet)}::jsonb, ${contentHash(packet)}, ${storageKey},
        '{"degraded":false,"overridden":false,"criticCycles":0,"lintPassed":true,"notes":[]}'::jsonb, '[]'::jsonb)
    `);
    const envelopeJson = JSON.stringify(envelope);
    await tx.execute(sql`
      INSERT INTO break_glass_packets (id, venture_id, artifact_id, recipient_public_key,
        recipient_key_fingerprint_sha256, algorithm, envelope, storage_key, status,
        idempotency_key, packet_checksum_sha256)
      VALUES (${packetId}, ${venture.id}, ${artifactId}, ${key.break_glass_public_key}, ${fingerprint},
        ${BREAK_GLASS_ALGORITHM}, ${envelopeJson}::jsonb, ${storageKey}, 'assembled',
        ${input.idempotencyKey}, ${createHash("sha256").update(envelopeJson).digest("hex")})
    `);
    await tx.execute(sql`
      INSERT INTO audit_log (account_id, actor, action, subject_type, subject_id, metadata)
      VALUES (${session.accountId}, ${`user:${session.userId}`}, 'handover.started', 'break_glass_packet', ${packetId},
        ${JSON.stringify({ ventureId: venture.id, artifactId, itemCount: packet.items.length, keyFingerprintSha256: fingerprint, recoveryMaterials: 0 })}::jsonb)
    `);
    return { packetId, artifactId, targetCompletionAt: packet.targetCompletionAt, created: true };
  });
}
