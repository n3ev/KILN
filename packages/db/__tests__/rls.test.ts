import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../client.js";

/**
 * Tenant isolation.
 *
 * CLAUDE.md §6.1 requires a test that asserts cross-tenant reads fail. Getting
 * that assertion to mean anything takes care: Postgres bypasses RLS for
 * superusers and (absent FORCE) for table owners, and the embedded database
 * connects as a superuser. So this suite drops to the `authenticated` role and
 * refuses to trust its own results until it has confirmed the drop worked.
 */

// Keep this suite isolated even when a root Vitest invocation does not load the
// package project/globalSetup. It must never seed Tenant A/B into the developer
// database or pass because a previously migrated database happens to exist.
const here = dirname(fileURLToPath(import.meta.url));
const testDataDir = process.env["KILN_RLS_TEST_PGDATA"] ?? resolve(here, "../../../.kiln/rls-suite-pgdata");
process.env["KILN_PGDATA"] = testDataDir;

let db: Database;
let closeDb: typeof import("../client.js").closeDb;
let execScript: typeof import("../client.js").execScript;
let rowsOf: typeof import("../client.js").rowsOf;
let asServiceRole: typeof import("../client.js").asServiceRole;
let withAccount: typeof import("../client.js").withAccount;
let assertAccountAccess: typeof import("../access.js").assertAccountAccess;
const accountA = randomUUID();
const accountB = randomUUID();
const ventureA = randomUUID();
const ventureB = randomUUID();
const helperRunA = randomUUID();
const helperRunB = randomUUID();
const packetA = randomUUID();
const packetB = randomUUID();

const brief = JSON.stringify({ oneLiner: "seeded for the isolation test" });

beforeAll(async () => {
  rmSync(testDataDir, { recursive: true, force: true });
  const client = await import("../client.js");
  const { applySchema } = await import("../migrate.js");
  closeDb = client.closeDb;
  execScript = client.execScript;
  rowsOf = client.rowsOf;
  asServiceRole = client.asServiceRole;
  withAccount = client.withAccount;
  ({ assertAccountAccess } = await import("../access.js"));
  await applySchema();
  db = await client.getDb();

  // Seed as superuser, before dropping privilege.
  await db.execute(sql`
    INSERT INTO accounts (id, name) VALUES (${accountA}, 'Tenant A'), (${accountB}, 'Tenant B')
    ON CONFLICT (id) DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO ventures (id, account_id, name, archetype, brief)
    VALUES (${ventureA}, ${accountA}, 'A venture', 'digital', ${brief}::jsonb),
           (${ventureB}, ${accountB}, 'B venture', 'digital', ${brief}::jsonb)
    ON CONFLICT (id) DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO runs (id, venture_id, playbook_id, playbook_version, seed)
    VALUES (${helperRunA}, ${ventureA}, 'test-helper', '1.0.0', 'helper-a'),
           (${helperRunB}, ${ventureB}, 'test-helper', '1.0.0', 'helper-b')
    ON CONFLICT (id) DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO break_glass_packets (id, venture_id, recipient_public_key,
      recipient_key_fingerprint_sha256, algorithm, envelope, storage_key, packet_checksum_sha256)
    VALUES
      (${packetA}, ${ventureA}, 'public-key-a', ${"a".repeat(64)},
        'x25519-hkdf-sha256+a256gcm', '{"ciphertext":"tenant-a"}'::jsonb, 'db:a', ${"1".repeat(64)}),
      (${packetB}, ${ventureB}, 'public-key-b', ${"b".repeat(64)},
        'x25519-hkdf-sha256+a256gcm', '{"ciphertext":"tenant-b"}'::jsonb, 'db:b', ${"2".repeat(64)})
    ON CONFLICT (id) DO NOTHING
  `);
});

afterAll(async () => {
  await execScript("RESET ROLE;");
  await closeDb();
  rmSync(testDataDir, { recursive: true, force: true });
});

/**
 * Flattens an error and its `cause` chain into one searchable string.
 *
 * Drizzle wraps driver errors in a DrizzleQueryError whose own message is only
 * "Failed query: ...". The reason the database refused — the RLS violation, the
 * append-only trigger — is one or two levels down in `cause`, so asserting on
 * `.message` alone would pass for *any* failure, including a typo in the SQL.
 */
function messageChain(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    parts.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }
  if (typeof current === "string") parts.push(current);
  return parts.join(" | ");
}

async function expectRejection(fn: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await fn();
  } catch (error) {
    expect(messageChain(error)).toMatch(pattern);
    return;
  }
  throw new Error(`Expected a rejection matching ${pattern}, but the statement succeeded.`);
}

/** Runs a statement as `authenticated` with the tenant GUC bound to `account`. */
async function asTenant(account: string, statement: string): Promise<unknown> {
  await execScript(`
    SET ROLE authenticated;
    SELECT set_config('kiln.account_id', '${account}', false);
  `);
  try {
    return await db.execute(sql.raw(statement));
  } finally {
    await execScript("RESET ROLE;");
  }
}

describe("row-level security", () => {
  it("actually drops out of superuser, or the rest of this file proves nothing", async () => {
    await execScript("SET ROLE authenticated;");
    // pg_user lists only LOGIN roles, and `authenticated` is NOLOGIN, so the
    // superuser flag has to come from pg_roles.
    const result = await db.execute(sql`
      SELECT current_user::text AS who,
             (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_super
    `);
    const rows = rowsOf<{ who: string; is_super: boolean }>(result);
    await execScript("RESET ROLE;");

    expect(rows[0]?.who).toBe("authenticated");
    expect(rows[0]?.is_super).toBe(false);
  });

  it("sees its own account", async () => {
    const result = await asTenant(accountA, `SELECT id FROM accounts`);
    const rows = rowsOf<{ id: string }>(result);
    expect(rows.map((r) => r.id)).toEqual([accountA]);
  });

  it("cannot read another tenant's account", async () => {
    const result = await asTenant(accountA, `SELECT id FROM accounts WHERE id = '${accountB}'`);
    expect(rowsOf(result)).toHaveLength(0);
  });

  it("cannot forge service access with a custom GUC", async () => {
    await execScript(`
      SET ROLE authenticated;
      SELECT set_config('kiln.account_id', '${accountA}', false);
      SELECT set_config('kiln.service_role', 'on', false);
    `);
    try {
      const result = await db.execute(sql`SELECT id FROM accounts ORDER BY id`);
      expect(rowsOf<{ id: string }>(result).map((row) => row.id)).toEqual([accountA]);
    } finally {
      await execScript("RESET ROLE;");
    }
  });

  it("does not grant authenticated membership in service_role", async () => {
    // The embedded connection's session_user is the bootstrap superuser, so it
    // can SET ROLE to anything even after `SET ROLE authenticated`. The catalog
    // membership check models a genuine authenticated login without poisoning
    // the shared PGlite connection via SET SESSION AUTHORIZATION.
    const result = await asTenant(
      accountA,
      `SELECT current_user::text AS role,
              (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS can_bypass_rls,
              pg_has_role(current_user, 'service_role', 'MEMBER') AS can_assume_service`,
    );
    expect(rowsOf<{ role: string; can_bypass_rls: boolean; can_assume_service: boolean }>(result)).toEqual([
      { role: "authenticated", can_bypass_rls: false, can_assume_service: false },
    ]);
  });

  it("keeps SECURITY DEFINER ownership helpers tenant-scoped even when service_role owns them", async () => {
    // current_user inside SECURITY DEFINER is the function owner. This catches
    // the catastrophic mistake of treating that identity as the caller's
    // service-role bypass: every authenticated caller would otherwise pass.
    await execScript(`
      ALTER FUNCTION kiln.owns_venture(uuid) OWNER TO service_role;
      ALTER FUNCTION kiln.owns_run(uuid) OWNER TO service_role;
    `);
    const result = await asTenant(
      accountA,
      `SELECT kiln.owns_venture('${ventureA}') AS own_venture,
              kiln.owns_venture('${ventureB}') AS foreign_venture,
              kiln.owns_run('${helperRunA}') AS own_run,
              kiln.owns_run('${helperRunB}') AS foreign_run`,
    );
    expect(
      rowsOf<{
        own_venture: boolean;
        foreign_venture: boolean;
        own_run: boolean;
        foreign_run: boolean;
      }>(result),
    ).toEqual([{ own_venture: true, foreign_venture: false, own_run: true, foreign_run: false }]);
  });

  it("withAccount drops privileged connections to authenticated before querying", async () => {
    const result = await withAccount(db, accountA, async (tx) =>
      tx.execute(sql`
        SELECT id, current_user::text AS role
        FROM accounts
        ORDER BY id
      `),
    );
    expect(rowsOf<{ id: string; role: string }>(result)).toEqual([{ id: accountA, role: "authenticated" }]);
  });

  it("asServiceRole uses the actual database role", async () => {
    const result = await asServiceRole(db, async (tx) =>
      tx.execute(sql`SELECT current_user::text AS role, count(*)::int AS accounts FROM accounts`),
    );
    expect(rowsOf<{ role: string; accounts: number }>(result)[0]).toEqual({ role: "service_role", accounts: 2 });
  });

  it("application access guard rejects a foreign resource even under service role", async () => {
    await expect(
      asServiceRole(db, (tx) => assertAccountAccess(tx, accountA, "run", helperRunA)),
    ).resolves.toBeUndefined();
    await expect(
      asServiceRole(db, (tx) => assertAccountAccess(tx, accountA, "run", helperRunB)),
    ).rejects.toMatchObject({ name: "AccountAccessDenied", resource: "run" });
  });

  it("cannot read another tenant's ventures", async () => {
    const result = await asTenant(accountA, `SELECT id FROM ventures`);
    const rows = rowsOf<{ id: string }>(result);
    expect(rows.map((r) => r.id)).toEqual([ventureA]);
  });

  it("isolates recipient-only break-glass envelopes by their venture", async () => {
    const result = await asTenant(accountA, `SELECT id, venture_id FROM break_glass_packets ORDER BY id`);
    expect(rowsOf<{ id: string; venture_id: string }>(result)).toEqual([{ id: packetA, venture_id: ventureA }]);
  });

  it("cannot register a break-glass key on another account", async () => {
    const result = await asTenant(
      accountA,
      `UPDATE accounts SET break_glass_public_key = 'smuggled-private-control' WHERE id = '${accountB}' RETURNING id`,
    );
    expect(rowsOf(result)).toHaveLength(0);
    const stored = rowsOf<{ break_glass_public_key: string | null }>(
      await db.execute(sql`SELECT break_glass_public_key FROM accounts WHERE id = ${accountB}`),
    );
    expect(stored[0]?.break_glass_public_key).toBeNull();
  });

  it("cannot write a venture into another tenant's account", async () => {
    await expectRejection(
      () =>
        asTenant(
          accountA,
          `INSERT INTO ventures (account_id, name, archetype, brief)
           VALUES ('${accountB}', 'smuggled', 'digital', '{}'::jsonb)`,
        ),
      /row-level security/i,
    );
    await execScript("RESET ROLE;");
  });

  it("cannot read credentials at all, even for its own venture", async () => {
    // Credentials have no tenant read path by design — service role only.
    const result = await asTenant(accountA, `SELECT id FROM credentials`);
    expect(rowsOf(result)).toHaveLength(0);
  });

  it("sees no rows when no account is bound", async () => {
    await execScript(`
      SET ROLE authenticated;
      SELECT set_config('kiln.account_id', '', false);
    `);
    const result = await db.execute(sql`SELECT id FROM ventures`);
    await execScript("RESET ROLE;");
    expect(rowsOf(result)).toHaveLength(0);
  });
});

describe("append-only event log", () => {
  const runId = randomUUID();

  beforeAll(async () => {
    await db.execute(sql`
      INSERT INTO runs (id, venture_id, playbook_id, playbook_version, seed)
      VALUES (${runId}, ${ventureA}, 'physical-shopify', '1.0.0', 'test-seed')
      ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO run_events (run_id, type, payload, actor)
      VALUES (${runId}, 'notice', '{"level":"info","message":"hello"}'::jsonb, 'system')
    `);
  });

  it("rejects UPDATE even as superuser", async () => {
    await expectRejection(
      () => db.execute(sql`UPDATE run_events SET type = 'tampered' WHERE run_id = ${runId}`),
      /append-only/i,
    );
  });

  it("rejects DELETE even as superuser", async () => {
    await expectRejection(
      () => db.execute(sql`DELETE FROM run_events WHERE run_id = ${runId}`),
      /append-only/i,
    );
  });

  it("still allows appends", async () => {
    await db.execute(sql`
      INSERT INTO run_events (run_id, type, payload, actor)
      VALUES (${runId}, 'notice', '{"level":"info","message":"second"}'::jsonb, 'system')
    `);
    const result = await db.execute(sql`SELECT count(*)::int AS n FROM run_events WHERE run_id = ${runId}`);
    expect(rowsOf<{ n: number }>(result)[0]?.n).toBe(2);
  });
});
