import { Scope } from "@kiln/contracts";
import { rowsOf } from "@kiln/db";
import { issueMcpToken, revokeMcpToken } from "@kiln/mcp/tokens";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { requireOperatorSession, withSessionAccount } from "../../../../lib/session";
import { enforceMutationRateLimit } from "../../../../lib/rate-limit";

export const dynamic = "force-dynamic";

const IssueRequest = z.object({
  label: z.string().trim().min(2).max(80),
  scopes: z.array(Scope).min(1),
  ttlHours: z.number().int().min(1).max(24 * 365).default(24 * 30),
  rateLimitPerMinute: z.number().int().min(1).max(1_000).default(60),
});
const RevokeRequest = z.object({ tokenId: z.string().uuid() });

export async function GET(): Promise<Response> {
  await requireOperatorSession();
  const tokens = await withSessionAccount(async (tx, session) =>
    rowsOf<{
      id: string;
      label: string;
      scopes: string[];
      rate_limit_per_minute: number;
      last_used_at: number | string | null;
      expires_at: number | string | null;
      revoked_at: number | string | null;
    }>(await tx.execute(sql`
      SELECT id, label, scopes, rate_limit_per_minute, last_used_at, expires_at, revoked_at
      FROM mcp_tokens WHERE account_id = ${session.accountId}
      ORDER BY created_at DESC
    `)),
  );
  return Response.json({ tokens }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const limited = await enforceMutationRateLimit(request, "mcp_token.issue", { accountLimit: 20, ipLimit: 12 });
  if (limited) return limited;
  const session = await requireOperatorSession();
  const parsed = IssueRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid token request", issues: parsed.error.flatten() }, { status: 400 });
  const issued = await issueMcpToken({ accountId: session.accountId, ...parsed.data });
  return Response.json(issued, { status: 201, headers: { "cache-control": "no-store" } });
}

export async function DELETE(request: Request): Promise<Response> {
  const limited = await enforceMutationRateLimit(request, "mcp_token.revoke", { accountLimit: 40, ipLimit: 25 });
  if (limited) return limited;
  const session = await requireOperatorSession();
  const parsed = RevokeRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid token id" }, { status: 400 });
  const revoked = await revokeMcpToken(session.accountId, parsed.data.tokenId);
  return Response.json({ revoked }, { status: revoked ? 200 : 404 });
}
