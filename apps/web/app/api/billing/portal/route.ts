import { startCustomerPortal } from "@kiln/billing";
import { config } from "@kiln/config";
import { requireSession } from "../../../../lib/session";
import { enforceMutationRateLimit } from "../../../../lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const limited = await enforceMutationRateLimit(request, "billing.portal", { accountLimit: 20, ipLimit: 12 });
  if (limited) return limited;
  const session = await requireSession();
  try {
    const portal = await startCustomerPortal({
      accountId: session.accountId,
      returnUrl: `${config().APP_URL}/billing`,
    });
    return Response.json(portal, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Portal could not be created" },
      { status: 422 },
    );
  }
}
