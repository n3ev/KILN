import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDataDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.kiln/web-account-data-test-pgdata");
process.env["KILN_PGDATA"] = testDataDir;

const accountId = randomUUID();
const ownerId = randomUUID();
const ventureId = randomUUID();
const runId = randomUUID();
const phaseId = randomUUID();
const taskId = randomUUID();
const artifactId = randomUUID();
const assetId = randomUUID();
const credentialId = randomUUID();
const connectionId = randomUUID();
const waiterId = randomUUID();
const jobId = randomUUID();
const foreignAccountId = randomUUID();
const foreignVentureId = randomUUID();
const foreignRunId = randomUUID();
const foreignWaiterId = randomUUID();
const foreignJobId = randomUUID();

const TOKEN_HASH_SENTINEL = "f".repeat(64);
const CIPHERTEXT_SENTINEL = "credential-ciphertext-must-never-leave-vault";
const NESTED_SECRET_SENTINEL = "nested-api-secret-must-be-removed";
const VALUE_SECRET_SENTINEL = "sk_live_51H8xKzABCDEFGHIJKLMNOP";
const PACKET_CIPHERTEXT_SENTINEL = "packet-envelope-ciphertext";

let dbModule: typeof import("@kiln/db");
let exportRoute: typeof import("../app/api/account/export/route");
let accountRoute: typeof import("../app/api/account/route");

beforeAll(async () => {
  rmSync(testDataDir, { recursive: true, force: true });
  dbModule = await import("@kiln/db");
  const { applySchema } = await import("@kiln/db/migrate");
  await applySchema();
  const db = await dbModule.getDb();
  await dbModule.asServiceRole(db, async (tx) => {
    await tx.execute(sql`
      INSERT INTO accounts (id, name, status, kyc_status)
      VALUES (${accountId}, 'Data Lifecycle Test', 'active', 'verified'),
             (${foreignAccountId}, 'Foreign Tenant', 'active', 'verified')
    `);
    await tx.execute(sql`
      INSERT INTO users (id, account_id, email, name, role)
      VALUES (${ownerId}, ${accountId}, 'demo@kiln.local', 'Data Owner', 'owner'),
             (${randomUUID()}, ${foreignAccountId}, 'foreign@example.test', 'Foreign Owner', 'owner')
    `);
    await tx.execute(sql`
      INSERT INTO ventures (id, account_id, name, archetype, brief)
      VALUES (${ventureId}, ${accountId}, 'Portable Venture', 'digital', '{"oneLiner":"portable"}'::jsonb),
             (${foreignVentureId}, ${foreignAccountId}, 'Foreign Venture', 'service', '{"oneLiner":"keep"}'::jsonb)
    `);
    await tx.execute(sql`
      INSERT INTO runs (id, venture_id, playbook_id, playbook_version, status, seed)
      VALUES (${runId}, ${ventureId}, 'digital-product', '1.0.0', 'succeeded', 'account-export'),
             (${foreignRunId}, ${foreignVentureId}, 'local-service', '1.0.0', 'succeeded', 'foreign')
    `);
    await tx.execute(sql`
      INSERT INTO phases (id, run_id, key, title, status, order_index)
      VALUES (${phaseId}, ${runId}, 'build', 'Build', 'succeeded', 0)
    `);
    await tx.execute(sql`
      INSERT INTO tasks (id, phase_id, agent_id, title, status, input)
      VALUES (${taskId}, ${phaseId}, 'operator', 'Portable task', 'succeeded',
        ${JSON.stringify({ apiKey: NESTED_SECRET_SENTINEL, publicNote: VALUE_SECRET_SENTINEL })}::jsonb)
    `);
    await tx.execute(sql`
      INSERT INTO artifacts (id, venture_id, run_id, type, status, content, content_hash, quality, sources, created_by_task_id)
      VALUES (${artifactId}, ${ventureId}, ${runId}, 'brand_system', 'accepted',
        ${JSON.stringify({ title: "Portable artifact", private_key: NESTED_SECRET_SENTINEL })}::jsonb,
        ${"a".repeat(64)}, '{}'::jsonb, '[]'::jsonb, ${taskId})
    `);
    await tx.execute(sql`
      INSERT INTO assets (id, venture_id, kind, provider, display_name, status)
      VALUES (${assetId}, ${ventureId}, 'site', 'vercel', 'Portable site', 'active')
    `);
    await tx.execute(sql`
      INSERT INTO connections (id, venture_id, provider, asset_id, status)
      VALUES (${connectionId}, ${ventureId}, 'vercel', ${assetId}, 'healthy')
    `);
    await tx.execute(sql`
      INSERT INTO credentials (id, asset_id, ciphertext, dek_wrapped, nonce, scopes)
      VALUES (${credentialId}, ${assetId}, convert_to(${CIPHERTEXT_SENTINEL}, 'UTF8'),
        decode('01020304', 'hex'), decode('05060708', 'hex'), ARRAY['site:write'])
    `);
    await tx.execute(sql`
      INSERT INTO mcp_tokens (account_id, label, token_hash, scopes)
      VALUES (${accountId}, 'export sentinel', ${TOKEN_HASH_SENTINEL}, ARRAY['artifact:read'])
    `);
    await tx.execute(sql`
      INSERT INTO break_glass_packets (venture_id, artifact_id, recipient_public_key,
        recipient_key_fingerprint_sha256, envelope, storage_key, packet_checksum_sha256)
      VALUES (${ventureId}, ${artifactId}, 'public-key-is-not-secret', ${"b".repeat(64)},
        ${JSON.stringify({ ciphertext: PACKET_CIPHERTEXT_SENTINEL })}::jsonb,
        'break-glass://test', ${"c".repeat(64)})
    `);
    await tx.execute(sql`
      INSERT INTO event_waiters (id, run_id, event_name, expires_at)
      VALUES (${waiterId}, ${runId}, 'checkpoint.decided', now() + interval '1 day'),
             (${foreignWaiterId}, ${foreignRunId}, 'checkpoint.decided', now() + interval '1 day')
    `);
    await tx.execute(sql`
      INSERT INTO job_queue (id, name, payload, idempotency_key)
      VALUES (${jobId}, 'run.execute', ${JSON.stringify({ runId })}::jsonb, ${`run:${runId}`}),
             (${foreignJobId}, 'run.execute', ${JSON.stringify({ runId: foreignRunId })}::jsonb, ${`run:${foreignRunId}`})
    `);
    await tx.execute(sql`
      INSERT INTO stripe_events (id, type, payload, status)
      VALUES ('evt_account_delete', 'checkout.session.completed',
        ${JSON.stringify({
          id: "evt_account_delete", type: "checkout.session.completed", created: 1, livemode: false,
          data: { object: { client_reference_id: accountId, metadata: { kiln_account_id: accountId } } },
        })}::jsonb, 'processed'),
        ('evt_foreign_keep', 'checkout.session.completed',
        ${JSON.stringify({
          id: "evt_foreign_keep", type: "checkout.session.completed", created: 1, livemode: false,
          data: { object: { client_reference_id: foreignAccountId, metadata: { kiln_account_id: foreignAccountId } } },
        })}::jsonb, 'processed')
    `);
  });
  exportRoute = await import("../app/api/account/export/route");
  accountRoute = await import("../app/api/account/route");
});

afterAll(async () => {
  await dbModule.closeDb();
  rmSync(testDataDir, { recursive: true, force: true });
});

describe.sequential("owner account data lifecycle", () => {
  it("downloads a no-store, allowlisted export without credential material", async () => {
    const response = await exportRoute.GET(new Request("https://kiln.test/api/account/export", {
      headers: { "x-forwarded-for": "203.0.113.40" },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(response.headers.get("x-content-sha256")).toMatch(/^[a-f0-9]{64}$/);

    const body = await response.text();
    const exported = JSON.parse(body) as { accountId: string; data: Record<string, unknown[]> };
    expect(exported.accountId).toBe(accountId);
    expect(exported.data["ventures"]).toHaveLength(1);
    expect(exported.data["mcpTokenDescriptors"]?.[0]).not.toHaveProperty("token_hash");
    expect(exported.data).not.toHaveProperty("credentials");
    expect(body).not.toContain(TOKEN_HASH_SENTINEL);
    expect(body).not.toContain(CIPHERTEXT_SENTINEL);
    expect(body).not.toContain(NESTED_SECRET_SENTINEL);
    expect(body).not.toContain(VALUE_SECRET_SENTINEL);
    expect(body).not.toContain(PACKET_CIPHERTEXT_SENTINEL);
    expect(body).not.toContain(foreignVentureId);
  });

  it("rolls back when the typed account name does not match", async () => {
    const response = await accountRoute.DELETE(new Request("https://kiln.test/api/account", {
      method: "DELETE",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.40" },
      body: JSON.stringify({ confirmation: "wrong account" }),
    }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "confirmation_mismatch" });

    const db = await dbModule.getDb();
    const accounts = await dbModule.asServiceRole(db, async (tx) =>
      dbModule.rowsOf<{ id: string }>(await tx.execute(sql`SELECT id FROM accounts WHERE id = ${accountId}`)),
    );
    expect(accounts).toHaveLength(1);
  });

  it("cascades tenant rows and explicitly removes waiters, jobs, and linked Stripe inbox events", async () => {
    const response = await accountRoute.DELETE(new Request("https://kiln.test/api/account", {
      method: "DELETE",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.40" },
      body: JSON.stringify({ confirmation: "Data Lifecycle Test" }),
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("clear-site-data")).toContain("cookies");
    const receipt = await response.json() as { deleted: boolean; removed: Record<string, number> };
    expect(receipt).toMatchObject({
      deleted: true,
      removed: { users: 1, ventures: 1, runs: 1, artifacts: 1, assets: 1, credentials: 1 },
    });
    expect(receipt.removed["eventWaiters"]).toBe(1);
    expect(receipt.removed["queuedJobs"]).toBe(1);
    expect(receipt.removed["stripeInboxEvents"]).toBe(1);

    const db = await dbModule.getDb();
    const state = await dbModule.asServiceRole(db, async (tx) => ({
      deletedAccounts: dbModule.rowsOf(await tx.execute(sql`SELECT id FROM accounts WHERE id = ${accountId}`)),
      deletedCredentials: dbModule.rowsOf(await tx.execute(sql`SELECT id FROM credentials WHERE id = ${credentialId}`)),
      deletedWaiters: dbModule.rowsOf(await tx.execute(sql`SELECT id FROM event_waiters WHERE id = ${waiterId}`)),
      deletedJobs: dbModule.rowsOf(await tx.execute(sql`SELECT id FROM job_queue WHERE id = ${jobId}`)),
      deletedStripeEvents: dbModule.rowsOf(await tx.execute(sql`SELECT id FROM stripe_events WHERE id = 'evt_account_delete'`)),
      foreignAccounts: dbModule.rowsOf(await tx.execute(sql`SELECT id FROM accounts WHERE id = ${foreignAccountId}`)),
      foreignWaiters: dbModule.rowsOf(await tx.execute(sql`SELECT id FROM event_waiters WHERE id = ${foreignWaiterId}`)),
      foreignJobs: dbModule.rowsOf(await tx.execute(sql`SELECT id FROM job_queue WHERE id = ${foreignJobId}`)),
      foreignStripeEvents: dbModule.rowsOf(await tx.execute(sql`SELECT id FROM stripe_events WHERE id = 'evt_foreign_keep'`)),
    }));
    expect(state.deletedAccounts).toHaveLength(0);
    expect(state.deletedCredentials).toHaveLength(0);
    expect(state.deletedWaiters).toHaveLength(0);
    expect(state.deletedJobs).toHaveLength(0);
    expect(state.deletedStripeEvents).toHaveLength(0);
    expect(state.foreignAccounts).toHaveLength(1);
    expect(state.foreignWaiters).toHaveLength(1);
    expect(state.foreignJobs).toHaveLength(1);
    expect(state.foreignStripeEvents).toHaveLength(1);
  });
});
