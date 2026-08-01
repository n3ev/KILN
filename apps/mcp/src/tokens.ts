import { createHash, randomBytes } from "node:crypto";
import { Scope, type Scope as ScopeValue } from "@kiln/contracts";
import { asServiceRole, getDb, rowsOf } from "@kiln/db";
import { sql } from "drizzle-orm";

export interface McpPrincipal {
  readonly tokenId: string;
  readonly accountId: string;
  readonly scopes: readonly ScopeValue[];
  readonly rateLimitPerMinute: number;
}

export interface IssuedMcpToken {
  readonly id: string;
  readonly token: string;
  readonly expiresAt: string;
}

const windows = new Map<string, { startedAt: number; count: number }>();

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Creates a 32-byte opaque token. The plaintext is returned once, never stored. */
export async function issueMcpToken(args: {
  accountId: string;
  label: string;
  scopes: readonly ScopeValue[];
  ttlHours?: number;
  rateLimitPerMinute?: number;
}): Promise<IssuedMcpToken> {
  const ttlHours = args.ttlHours ?? 24 * 30;
  const rateLimit = args.rateLimitPerMinute ?? 60;
  if (!Number.isFinite(ttlHours) || ttlHours <= 0 || ttlHours > 24 * 365) {
    throw new Error("MCP token ttlHours must be between 0 and 8760");
  }
  if (!Number.isInteger(rateLimit) || rateLimit < 1 || rateLimit > 10_000) {
    throw new Error("MCP token rateLimitPerMinute must be an integer from 1 to 10000");
  }
  const token = `kiln_mcp_${randomBytes(32).toString("base64url")}`;
  const expiresAtMs = Date.now() + ttlHours * 3_600_000;
  const scopeValues = sql.join(args.scopes.map((scope) => sql`${scope}`), sql`, `);
  const db = await getDb();
  const rows = await asServiceRole(db, async (tx) =>
    rowsOf<{ id: string }>(
      await tx.execute(sql`
        INSERT INTO mcp_tokens (account_id, label, token_hash, scopes, rate_limit_per_minute, expires_at)
        VALUES (${args.accountId}, ${args.label}, ${hashToken(token)}, ARRAY[${scopeValues}]::text[],
                ${rateLimit}, ${expiresAtMs})
        RETURNING id
      `),
    ),
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("MCP token insert returned no id");
  return { id, token, expiresAt: new Date(expiresAtMs).toISOString() };
}

export async function authenticateMcpToken(token: string): Promise<McpPrincipal | undefined> {
  const db = await getDb();
  const rows = await asServiceRole(db, async (tx) =>
    rowsOf<{
      id: string;
      account_id: string;
      scopes: string[];
      rate_limit_per_minute: number;
      expires_at: number | string | null;
      revoked_at: number | string | null;
    }>(
      await tx.execute(sql`
        SELECT id, account_id, scopes, rate_limit_per_minute, expires_at, revoked_at
        FROM mcp_tokens
        WHERE token_hash = ${hashToken(token)}
        LIMIT 1
      `),
    ),
  );
  const row = rows[0];
  if (!row || row.revoked_at !== null) return undefined;
  if (row.expires_at !== null && Number(row.expires_at) <= Date.now()) return undefined;

  const scopes = Scope.array().safeParse(row.scopes);
  if (!scopes.success) return undefined;
  const principal: McpPrincipal = {
    tokenId: row.id,
    accountId: row.account_id,
    scopes: scopes.data,
    rateLimitPerMinute: row.rate_limit_per_minute,
  };
  if (!takeRateLimit(principal)) return undefined;

  await asServiceRole(db, async (tx) => {
    await tx.execute(sql`UPDATE mcp_tokens SET last_used_at = ${Date.now()} WHERE id = ${row.id}`);
  });
  return principal;
}

export async function revokeMcpToken(accountId: string, tokenId: string): Promise<boolean> {
  const db = await getDb();
  const rows = await asServiceRole(db, async (tx) =>
    rowsOf<{ id: string }>(
      await tx.execute(sql`
        UPDATE mcp_tokens SET revoked_at = ${Date.now()}
        WHERE id = ${tokenId} AND account_id = ${accountId} AND revoked_at IS NULL
        RETURNING id
      `),
    ),
  );
  windows.delete(tokenId);
  return rows.length === 1;
}

function takeRateLimit(principal: McpPrincipal): boolean {
  const now = Date.now();
  const current = windows.get(principal.tokenId);
  if (!current || now - current.startedAt >= 60_000) {
    windows.set(principal.tokenId, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= principal.rateLimitPerMinute) return false;
  current.count++;
  return true;
}
