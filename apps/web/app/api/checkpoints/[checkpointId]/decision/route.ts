import { z } from "zod";
import { decideCheckpoint } from "../../../../../lib/queries";
import { enforceMutationRateLimit } from "../../../../../lib/rate-limit";

export const dynamic = "force-dynamic";

const Decision = z.object({
  status: z.enum(["approved", "rejected"]),
  optionId: z.string().min(1),
  note: z.string().trim().min(1).max(1000).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ checkpointId: string }> }) {
  const limited = await enforceMutationRateLimit(request, "checkpoint.decide", { accountLimit: 40, ipLimit: 25 });
  if (limited) return limited;
  const { checkpointId } = await params;
  const parsed = Decision.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid checkpoint decision." }, { status: 400 });
  try {
    const checkpoint = await decideCheckpoint(checkpointId, parsed.data);
    if (!checkpoint) return Response.json({ error: "Checkpoint not found." }, { status: 404 });
    return Response.json({ checkpoint }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Decision failed." }, { status: 409 });
  }
}
