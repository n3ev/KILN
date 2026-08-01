import { rowsOf } from "@kiln/db";
import { sql } from "drizzle-orm";
import { withSessionAccount } from "./session";

interface LimitOptions {
  readonly accountLimit?: number;
  readonly ipLimit?: number;
  readonly windowSeconds?: number;
}

interface CountRow {
  readonly account_count: number | string | bigint;
  readonly ip_count: number | string | bigint;
}

function boundedInteger(value: number | undefined, fallback: number, maximum: number): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0
    ? Math.min(value ?? fallback, maximum)
    : fallback;
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const raw = forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
  return /^[a-f\d:.]{2,64}$/i.test(raw) ? raw : "unknown";
}

/**
 * Durable, append-only mutation limiter. The audit log doubles as the counter,
 * so limits remain effective across web replicas without introducing Redis as
 * a hard dependency in the zero-key path.
 */
export async function enforceMutationRateLimit(
  request: Request,
  action: string,
  options: LimitOptions = {},
): Promise<Response | undefined> {
  const accountLimit = boundedInteger(options.accountLimit, 60, 10_000);
  const ipLimit = boundedInteger(options.ipLimit, 30, 10_000);
  const windowSeconds = boundedInteger(options.windowSeconds, 60, 3_600);
  const since = new Date(Date.now() - windowSeconds * 1_000).toISOString();
  const ip = clientIp(request);
  const auditAction = `rate_limit.${action}`;

  try {
    const exceeded = await withSessionAccount(async (tx, session) => {
      // Serialise counters for this account/action so concurrent requests
      // cannot all observe the same value and pass together.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${session.accountId}:${auditAction}`}))`);
      const counts = rowsOf<CountRow>(await tx.execute(sql`
        SELECT count(*)::bigint AS account_count,
          count(*) FILTER (WHERE ip = ${ip})::bigint AS ip_count
        FROM audit_log
        WHERE account_id = ${session.accountId}
          AND action = ${auditAction}
          AND created_at >= ${since}::timestamptz
      `))[0];
      const accountCount = Number(counts?.account_count ?? 0);
      const ipCount = Number(counts?.ip_count ?? 0);
      if (accountCount >= accountLimit || ipCount >= ipLimit) return true;

      await tx.execute(sql`
        INSERT INTO audit_log (account_id, actor, action, subject_type, ip, user_agent, metadata)
        VALUES (${session.accountId}, ${`user:${session.userId}`}, ${auditAction}, 'http_mutation', ${ip},
          ${request.headers.get("user-agent")?.slice(0, 512) ?? null},
          ${JSON.stringify({ accountLimit, ipLimit, windowSeconds })}::jsonb)
      `);
      return false;
    });

    if (!exceeded) return undefined;
    return Response.json(
      { error: "Too many mutation requests. Try again shortly." },
      { status: 429, headers: { "retry-after": String(windowSeconds), "cache-control": "no-store" } },
    );
  } catch {
    // Security controls fail closed. A missing limiter is not a reason to let a
    // burst of state-changing requests through unnoticed.
    return Response.json(
      { error: "Mutation protection is temporarily unavailable." },
      { status: 503, headers: { "retry-after": "5", "cache-control": "no-store" } },
    );
  }
}
