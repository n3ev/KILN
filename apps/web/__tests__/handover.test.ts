import { generateKeyPairSync, randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HandoverPacket } from "@kiln/contracts";
import { decryptBreakGlassPayload } from "@kiln/connectors/handover/decrypt";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDataDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.kiln/web-handover-test-pgdata");
process.env["KILN_PGDATA"] = testDataDir;

const accountId = randomUUID();
const userId = randomUUID();
const ventureId = randomUUID();
const runId = randomUUID();
const assetId = randomUUID();
const idempotencyKey = randomUUID();
const keys = generateKeyPairSync("x25519");
const publicPem = keys.publicKey.export({ format: "pem", type: "spki" }).toString();
const privatePem = keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString();

let dbModule: typeof import("@kiln/db");
let handover: typeof import("../lib/handover");

beforeAll(async () => {
  rmSync(testDataDir, { recursive: true, force: true });
  dbModule = await import("@kiln/db");
  const { applySchema } = await import("@kiln/db/migrate");
  await applySchema();
  const db = await dbModule.getDb();
  await dbModule.asServiceRole(db, async (tx) => {
    await tx.execute(sql`INSERT INTO accounts (id, name, status) VALUES (${accountId}, 'Handover test', 'active')`);
    await tx.execute(sql`
      INSERT INTO users (id, account_id, email, name, role)
      VALUES (${userId}, ${accountId}, 'demo@kiln.local', 'Test Owner', 'owner')
    `);
    await tx.execute(sql`
      INSERT INTO ventures (id, account_id, name, archetype, status, ownership_mode, brief)
      VALUES (${ventureId}, ${accountId}, 'Transferable venture', 'digital', 'live', 'managed',
        '{"oneLiner":"A fixture whose custody can be transferred."}'::jsonb)
    `);
    await tx.execute(sql`
      INSERT INTO runs (id, venture_id, playbook_id, playbook_version, status, seed)
      VALUES (${runId}, ${ventureId}, 'digital-product', '1.0.0', 'succeeded', 'handover-test')
    `);
    await tx.execute(sql`
      INSERT INTO assets (id, venture_id, kind, provider, external_id, display_name, ownership_mode, status)
      VALUES (${assetId}, ${ventureId}, 'domain', 'registrar', 'example.test', 'Primary domain', 'managed', 'active')
    `);
  });
  handover = await import("../lib/handover");
});

afterAll(async () => {
  await dbModule.closeDb();
  rmSync(testDataDir, { recursive: true, force: true });
});

describe("handover command", () => {
  it("registers only the public half and atomically creates an artifact, envelope, and audit event", async () => {
    const registration = await handover.registerBreakGlassPublicKey({ publicKeyPem: publicPem });
    expect(registration.fingerprintSha256).toMatch(/^[a-f0-9]{64}$/);

    const receipt = await handover.startHandover({ ventureId, idempotencyKey });
    const retry = await handover.startHandover({ ventureId, idempotencyKey });
    expect(receipt.created).toBe(true);
    expect(retry).toEqual({ ...receipt, created: false });

    const db = await dbModule.getDb();
    const result = await dbModule.asServiceRole(db, async (tx) => {
      return tx.execute(sql`
        SELECT p.recipient_public_key, p.envelope, a.content, l.action, l.metadata
        FROM break_glass_packets p JOIN artifacts a ON a.id = p.artifact_id
        JOIN audit_log l ON l.subject_id = p.id::text
        WHERE p.id = ${receipt.packetId}
      `);
    });
    const rows = dbModule.rowsOf<{
      recipient_public_key: string;
      envelope: unknown;
      content: unknown;
      action: string;
      metadata: unknown;
    }>(result);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.recipient_public_key).toBe(publicPem);
    const persisted = JSON.stringify(row);
    expect(persisted).not.toContain(privatePem);
    expect(row.action).toBe("handover.started");
    expect(HandoverPacket.parse(row.content).items[0]).toMatchObject({ assetId, kind: "domain", ownershipMode: "managed" });

    const envelope = typeof row.envelope === "string" ? JSON.parse(row.envelope) as unknown : row.envelope;
    const decrypted = decryptBreakGlassPayload(envelope as Parameters<typeof decryptBreakGlassPayload>[0], privatePem);
    expect(decrypted.packet.ventureId).toBe(ventureId);
    expect(decrypted.exportData).toMatchObject({ venture: { id: ventureId }, assets: [{ id: assetId }] });
    expect(decrypted.recoveryMaterials).toEqual([]);
  });
});
