import { createHash } from "node:crypto";
import { createAccountExport, stringifyAccountExport } from "../../../../lib/account-data";
import { enforceMutationRateLimit } from "../../../../lib/rate-limit";
import { requireOwnerSession, SessionAccessError } from "../../../../lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const session = await requireOwnerSession();
    const limited = await enforceMutationRateLimit(request, "account.export", {
      accountLimit: 10,
      ipLimit: 5,
      windowSeconds: 3_600,
    });
    if (limited) return limited;

    const accountExport = await createAccountExport();
    const body = stringifyAccountExport(accountExport);
    const date = accountExport.generatedAt.slice(0, 10);
    const filename = `kiln-account-${session.accountId}-${date}.json`;
    return new Response(body, {
      headers: {
        "cache-control": "private, no-store, max-age=0",
        "content-disposition": `attachment; filename="${filename}"`,
        "content-type": "application/json; charset=utf-8",
        "x-content-sha256": createHash("sha256").update(body).digest("hex"),
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return Response.json({ error: error.message, code: error.code }, {
        status: 403,
        headers: { "cache-control": "no-store" },
      });
    }
    throw error;
  }
}
