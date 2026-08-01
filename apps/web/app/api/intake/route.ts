import { IntakeCommandError, IntakeDraft, createIntakeRun } from "../../../lib/intake";
import { enforceMutationRateLimit } from "../../../lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const limited = await enforceMutationRateLimit(request, "intake.create", { accountLimit: 12, ipLimit: 8 });
  if (limited) return limited;
  const parsed = IntakeDraft.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "The brief is incomplete.", issues: parsed.error.flatten() }, { status: 400 });
  try {
    const receipt = await createIntakeRun(parsed.data);
    return Response.json({ accepted: true, queued: true, ...receipt }, { status: receipt.created ? 201 : 200, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof IntakeCommandError) {
      return Response.json({ error: error.message, code: error.code, retryable: error.code === "queue_unavailable" }, { status: error.status, headers: { "cache-control": "no-store" } });
    }
    throw error;
  }
}
