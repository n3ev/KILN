import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetConfigCache } from "@kiln/config";
import { asServiceRole, closeDb, getDb, rowsOf } from "@kiln/db";
import { applySchema } from "@kiln/db/migrate";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authenticateMcpToken, issueMcpToken, revokeMcpToken } from "../tokens.js";

const temp = mkdtempSync(join(tmpdir(), "kiln-mcp-"));
const accountId = "00000000-0000-4000-8000-000000000041";

beforeAll(async () => {
  process.env["KILN_PGDATA"] = join(temp, "pgdata");
  resetConfigCache();
  await applySchema();
  const db = await getDb();
  await asServiceRole(db, async (tx) => {
    await tx.execute(sql`INSERT INTO accounts (id, name) VALUES (${accountId}, 'MCP test')`);
  });
});

afterAll(async () => {
  await closeDb();
  delete process.env["KILN_PGDATA"];
  resetConfigCache();
  rmSync(temp, { recursive: true, force: true });
});

describe("MCP token boundary", () => {
  it("stores only a hash and authenticates the issued scope", async () => {
    const issued = await issueMcpToken({
      accountId,
      label: "CI",
      scopes: ["research:read"],
      rateLimitPerMinute: 2,
    });
    expect(issued.token).toMatch(/^kiln_mcp_[A-Za-z0-9_-]{43}$/);
    const db = await getDb();
    const stored = await asServiceRole(db, async (tx) =>
      rowsOf<{ token_hash: string }>(
        await tx.execute(sql`SELECT token_hash FROM mcp_tokens WHERE id = ${issued.id}`),
      )[0],
    );
    expect(stored?.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored?.token_hash).not.toContain(issued.token);
    expect(await authenticateMcpToken(issued.token)).toMatchObject({
      accountId,
      scopes: ["research:read"],
    });
  });

  it("enforces per-token rate limits", async () => {
    const issued = await issueMcpToken({
      accountId,
      label: "one call",
      scopes: ["analytics:read"],
      rateLimitPerMinute: 1,
    });
    expect(await authenticateMcpToken(issued.token)).toBeDefined();
    expect(await authenticateMcpToken(issued.token)).toBeUndefined();
  });

  it("revokes only within the owning account", async () => {
    const issued = await issueMcpToken({ accountId, label: "revoke", scopes: ["research:read"] });
    expect(await revokeMcpToken("00000000-0000-4000-8000-000000000099", issued.id)).toBe(false);
    expect(await revokeMcpToken(accountId, issued.id)).toBe(true);
    expect(await authenticateMcpToken(issued.token)).toBeUndefined();
  });

  it("rejects unsafe token settings", async () => {
    await expect(issueMcpToken({ accountId, label: "bad", scopes: [], ttlHours: 0 })).rejects.toThrow(/ttlHours/);
    await expect(issueMcpToken({ accountId, label: "bad", scopes: [], rateLimitPerMinute: 0 })).rejects.toThrow(/rateLimit/);
  });
});

