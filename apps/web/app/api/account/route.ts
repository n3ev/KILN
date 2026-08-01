import { AccountDataCommandError, deleteCurrentAccount } from "../../../lib/account-data";
import { enforceMutationRateLimit } from "../../../lib/rate-limit";
import { requireOwnerSession, SessionAccessError } from "../../../lib/session";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request): Promise<Response> {
  try {
    await requireOwnerSession();
    const limited = await enforceMutationRateLimit(request, "account.delete", {
      accountLimit: 5,
      ipLimit: 5,
      windowSeconds: 3_600,
    });
    if (limited) return limited;

    const body = await request.json().catch(() => null);
    const receipt = await deleteCurrentAccount(body);
    return Response.json(receipt, {
      headers: {
        "cache-control": "no-store",
        "clear-site-data": '"cache", "cookies", "storage"',
      },
    });
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return Response.json({ error: error.message, code: error.code }, {
        status: 403,
        headers: { "cache-control": "no-store" },
      });
    }
    if (error instanceof AccountDataCommandError) {
      return Response.json({ error: error.message, code: error.code }, {
        status: error.status,
        headers: { "cache-control": "no-store" },
      });
    }
    if (error instanceof Error && error.name === "ZodError") {
      return Response.json({ error: "A valid account-name confirmation is required." }, {
        status: 400,
        headers: { "cache-control": "no-store" },
      });
    }
    throw error;
  }
}
