import { z } from "zod";
import { getHandoverSummary, HandoverCommandError, startHandover } from "../../../lib/handover";
import { enforceMutationRateLimit } from "../../../lib/rate-limit";

export const dynamic = "force-dynamic";

const StartRequest = z.object({ ventureId: z.string().uuid(), idempotencyKey: z.string().uuid() });

export async function GET(): Promise<Response> {
  const summary = await getHandoverSummary();
  return Response.json(summary, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const limited = await enforceMutationRateLimit(request, "handover.start", { accountLimit: 10, ipLimit: 6 });
  if (limited) return limited;
  const parsed = StartRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid handover request.", issues: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const receipt = await startHandover(parsed.data);
    return Response.json(receipt, {
      status: receipt.created ? 201 : 200,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof HandoverCommandError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status, headers: { "cache-control": "no-store" } });
    }
    throw error;
  }
}
