import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CredentialUnavailable } from "@kiln/contracts";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@kiln/db";

const here = dirname(fileURLToPath(import.meta.url));
const testDataDir = process.env["KILN_VAULT_TEST_PGDATA"] ?? resolve(here, "../../../.kiln/vault-suite-pgdata");
const testKeyFile = process.env["KILN_VAULT_TEST_KEYFILE"] ?? resolve(here, "../../../.kiln/vault-suite-kek.key");
process.env["KILN_PGDATA"] = testDataDir;
process.env["KILN_KEYFILE"] = testKeyFile;

let db: Database;
let getDb: typeof import("@kiln/db").getDb;
let closeDb: typeof import("@kiln/db").closeDb;
let rowsOf: typeof import("@kiln/db").rowsOf;
let lease: typeof import("../index.js").lease;
let revokeLease: typeof import("../index.js").revokeLease;
let rotate: typeof import("../index.js").rotate;
let storeCredential: typeof import("../index.js").storeCredential;
let withCredential: typeof import("../index.js").withCredential;

const accountA = randomUUID();
const accountB = randomUUID();
const ventureA = randomUUID();
const ventureB = randomUUID();
const assetA = randomUUID();
const assetB = randomUUID();

beforeAll(async () => {
  rmSync(testDataDir, { recursive: true, force: true });
  rmSync(testKeyFile, { force: true });
  const client = await import("@kiln/db");
  const { applySchema } = await import("@kiln/db/migrate");
  const vault = await import("../index.js");
  getDb = client.getDb;
  closeDb = client.closeDb;
  rowsOf = client.rowsOf;
  lease = vault.lease;
  revokeLease = vault.revokeLease;
  rotate = vault.rotate;
  storeCredential = vault.storeCredential;
  withCredential = vault.withCredential;
  await applySchema();
  db = await getDb();
  await db.execute(sql`
    INSERT INTO accounts (id, name) VALUES (${accountA}, 'Vault tenant A'), (${accountB}, 'Vault tenant B')
  `);
  await db.execute(sql`
    INSERT INTO ventures (id, account_id, name, archetype, brief)
    VALUES (${ventureA}, ${accountA}, 'A', 'physical', '{}'::jsonb),
           (${ventureB}, ${accountB}, 'B', 'physical', '{}'::jsonb)
  `);
  await db.execute(sql`
    INSERT INTO assets (id, venture_id, kind, provider, display_name, status)
    VALUES (${assetA}, ${ventureA}, 'store', 'shopify', 'A store', 'active'),
           (${assetB}, ${ventureB}, 'store', 'shopify', 'B store', 'active')
  `);
});

afterAll(async () => {
  await closeDb();
  rmSync(testDataDir, { recursive: true, force: true });
  rmSync(testKeyFile, { force: true });
});

describe("account-bound envelope encryption", () => {
  it("does not export a general plaintext or key-provider API", async () => {
    const api: Record<string, unknown> = await import("../index.js");
    expect(api).not.toHaveProperty("open");
    expect(api).not.toHaveProperty("unseal");
    expect(api).not.toHaveProperty("keyProvider");
    expect(api).not.toHaveProperty("createLocalKeyProvider");
  });

  it("cannot decrypt ciphertext copied from account A into account B", async () => {
    const { credentialId } = await storeCredential({
      accountId: accountA,
      assetId: assetA,
      provider: "shopify",
      plaintext: "account_a_only",
      scopes: ["commerce:read"],
    });
    const copiedCredentialId = randomUUID();
    await db.execute(sql`
      INSERT INTO credentials
        (id, asset_id, ciphertext, dek_wrapped, nonce, scopes, rotation_policy, expires_at)
      SELECT ${copiedCredentialId}, ${assetB}, ciphertext, dek_wrapped, nonce, scopes,
             rotation_policy, expires_at
      FROM credentials
      WHERE id = ${credentialId}
    `);
    const copiedHandle = await lease({
      credentialId: copiedCredentialId,
      accountId: accountB,
      provider: "shopify",
      scopes: ["commerce:read"],
      ttlSeconds: 30,
      toolId: "shopify.product.read",
      purpose: "prove cryptographic tenant binding",
    });
    await expect(
      withCredential(
        {
          handle: copiedHandle,
          accountId: accountB,
          provider: "shopify",
          toolId: "shopify.product.read",
          scopes: ["commerce:read"],
        },
        async () => undefined,
      ),
    ).rejects.toBeInstanceOf(CredentialUnavailable);
  });
});

describe("vault boundary", () => {
  it("finds no credential-ciphertext query outside packages/vault", () => {
    const root = resolve(here, "../../..");
    const offenders: string[] = [];
    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (["node_modules", ".next", ".turbo", "dist"].includes(entry.name)) continue;
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) {
          if (path === resolve(root, "packages/vault")) continue;
          visit(path);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        const source = readFileSync(path, "utf8");
        if (
          /credentials\s*\.\s*ciphertext/.test(source) ||
          /\.from\(\s*credentials\s*\)/.test(source) ||
          /select[\s\S]{0,400}ciphertext[\s\S]{0,400}from\s+credentials/i.test(source)
        ) {
          offenders.push(path.slice(root.length + 1));
        }
      }
    };
    visit(resolve(root, "packages"));
    visit(resolve(root, "apps"));
    expect(offenders).toEqual([]);
  });
});

describe("credential leases", () => {
  it("persists an opaque lease and exposes plaintext only inside the callback", async () => {
    const { credentialId } = await storeCredential({
      accountId: accountA,
      assetId: assetA,
      provider: "shopify",
      plaintext: "shpat_test_secret",
      scopes: ["commerce:read", "commerce:write"],
    });
    const handle = await lease({
      credentialId,
      accountId: accountA,
      provider: "shopify",
      scopes: ["commerce:read"],
      ttlSeconds: 60,
      toolId: "shopify.product.read",
      purpose: "read a product before updating it",
    });

    expect(handle.id).not.toContain(credentialId);
    await expect(
      withCredential(
        {
          handle,
          accountId: accountA,
          provider: "shopify",
          toolId: "shopify.product.read",
          scopes: ["commerce:read"],
        },
        async (secret) => `Bearer ${secret}`,
      ),
    ).resolves.toBe("Bearer shpat_test_secret");

    const rows = rowsOf<{ tool_id: string; purpose: string }>(
      await db.execute(sql`SELECT tool_id, purpose FROM credential_leases WHERE id = ${handle.id}`),
    );
    expect(rows).toEqual([
      { tool_id: "shopify.product.read", purpose: "read a product before updating it" },
    ]);
  });

  it("rejects cross-account, over-scoped, and wrong-tool use", async () => {
    const { credentialId } = await storeCredential({
      accountId: accountA,
      assetId: assetA,
      provider: "shopify",
      plaintext: "second_secret",
      scopes: ["commerce:read"],
    });

    await expect(
      lease({
        credentialId,
        accountId: accountB,
        provider: "shopify",
        scopes: ["commerce:read"],
        ttlSeconds: 30,
        toolId: "shopify.product.read",
        purpose: "cross-account attempt",
      }),
    ).rejects.toBeInstanceOf(CredentialUnavailable);

    await expect(
      lease({
        credentialId,
        accountId: accountA,
        provider: "shopify",
        scopes: ["commerce:write"],
        ttlSeconds: 30,
        toolId: "shopify.product.upsert",
        purpose: "over-scoped attempt",
      }),
    ).rejects.toBeInstanceOf(CredentialUnavailable);

    const handle = await lease({
      credentialId,
      accountId: accountA,
      provider: "shopify",
      scopes: ["commerce:read"],
      ttlSeconds: 30,
      toolId: "shopify.product.read",
      purpose: "correct lease",
    });
    await expect(
      withCredential(
        {
          handle,
          accountId: accountA,
          provider: "shopify",
          toolId: "shopify.product.upsert",
          scopes: ["commerce:read"],
        },
        async () => undefined,
      ),
    ).rejects.toBeInstanceOf(CredentialUnavailable);
  });

  it("revokes without deleting the audit row", async () => {
    const { credentialId } = await storeCredential({
      accountId: accountA,
      assetId: assetA,
      provider: "shopify",
      plaintext: "revocable_secret",
      scopes: ["commerce:read"],
    });
    const handle = await lease({
      credentialId,
      accountId: accountA,
      provider: "shopify",
      scopes: ["commerce:read"],
      ttlSeconds: 30,
      toolId: "shopify.product.read",
      purpose: "revocation test",
    });
    await expect(revokeLease(handle.id, accountA)).resolves.toBe(true);
    await expect(
      withCredential(
        {
          handle,
          accountId: accountA,
          provider: "shopify",
          toolId: "shopify.product.read",
          scopes: ["commerce:read"],
        },
        async () => undefined,
      ),
    ).rejects.toBeInstanceOf(CredentialUnavailable);

    const rows = rowsOf<{ count: number }>(
      await db.execute(sql`SELECT count(*)::int AS count FROM credential_leases WHERE id = ${handle.id}`),
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("rotates verified credentials and expires outstanding leases", async () => {
    const { credentialId } = await storeCredential({
      accountId: accountA,
      assetId: assetA,
      provider: "shopify",
      plaintext: "old_secret",
      scopes: ["commerce:read"],
      rotationPolicy: "supported",
    });
    const oldHandle = await lease({
      credentialId,
      accountId: accountA,
      provider: "shopify",
      scopes: ["commerce:read"],
      ttlSeconds: 30,
      toolId: "shopify.product.read",
      purpose: "issued before rotation",
    });

    await expect(
      rotate({
        credentialId,
        accountId: accountA,
        provider: "shopify",
        issue: async () => "new_secret",
        verify: async (secret) => secret === "new_secret",
      }),
    ).resolves.toEqual({ rotated: true });

    await expect(
      withCredential(
        {
          handle: oldHandle,
          accountId: accountA,
          provider: "shopify",
          toolId: "shopify.product.read",
          scopes: ["commerce:read"],
        },
        async () => undefined,
      ),
    ).rejects.toBeInstanceOf(CredentialUnavailable);

    const newHandle = await lease({
      credentialId,
      accountId: accountA,
      provider: "shopify",
      scopes: ["commerce:read"],
      ttlSeconds: 30,
      toolId: "shopify.product.read",
      purpose: "issued after rotation",
    });
    await expect(
      withCredential(
        {
          handle: newHandle,
          accountId: accountA,
          provider: "shopify",
          toolId: "shopify.product.read",
          scopes: ["commerce:read"],
        },
        async (secret) => secret,
      ),
    ).resolves.toBe("new_secret");
  });
});
