import { z } from "zod";
import { decideAbuseReview } from "../../../../../lib/abuse";
import { enforceMutationRateLimit } from "../../../../../lib/rate-limit";
import { requireOperatorSession } from "../../../../../lib/session";

export const dynamic = "force-dynamic";
const Decision = z.object({ status: z.enum(["cleared", "blocked"]), note: z.string().trim().min(3).max(2_000) });

export async function POST(request: Request, { params }: { params: Promise<{ reviewId: string }> }): Promise<Response> {
  await requireOperatorSession();
  const limited = await enforceMutationRateLimit(request, "abuse.review", { accountLimit: 40, ipLimit: 20 });
  if (limited) return limited;
  const parsed = Decision.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "A review decision and note are required." }, { status: 400 });
  const { reviewId } = await params;
  const decided = await decideAbuseReview(reviewId, parsed.data);
  return decided
    ? Response.json({ decided: true }, { headers: { "cache-control": "no-store" } })
    : Response.json({ error: "Pending review not found." }, { status: 404 });
}
