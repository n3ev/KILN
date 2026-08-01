import { startCheckout } from "@kiln/billing";
import { config } from "@kiln/config";
import { z } from "zod";
import { requireSession } from "../../../../lib/session";
import { enforceMutationRateLimit } from "../../../../lib/rate-limit";

export const dynamic = "force-dynamic";

const RequestBody = z.object({
  planId: z.string().uuid(),
  interval: z.enum(["week", "month", "year"]).default("week"),
});

export async function POST(request: Request): Promise<Response> {
  const limited = await enforceMutationRateLimit(request, "billing.checkout", { accountLimit: 12, ipLimit: 8 });
  if (limited) return limited;
  const session = await requireSession();
  const parsed = RequestBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid checkout request" }, { status: 400 });
  const base = config().APP_URL;
  try {
    const checkout = await startCheckout({
      accountId: session.accountId,
      planId: parsed.data.planId,
      customerEmail: session.email,
      interval: parsed.data.interval,
      successUrl: `${base}/billing?checkout=success`,
      cancelUrl: `${base}/billing?checkout=cancelled`,
    });
    return Response.json(checkout, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Checkout could not be created" },
      { status: 422 },
    );
  }
}
