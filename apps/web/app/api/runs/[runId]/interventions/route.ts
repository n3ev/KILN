import { HumanDirectiveRequest } from "@kiln/contracts";
import { AccountAccessDenied } from "@kiln/db";
import { RunDirectiveCommandError, submitRunDirective } from "../../../../../lib/interventions";
import { enforceMutationRateLimit } from "../../../../../lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const limited = await enforceMutationRateLimit(request, "run.intervene", { accountLimit: 30, ipLimit: 20 });
  if (limited) return limited;
  const { runId } = await params;
  const parsed = HumanDirectiveRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "A valid directive id and an instruction between 3 and 1,000 characters are required." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    const receipt = await submitRunDirective(runId, parsed.data);
    return Response.json(receipt, { status: 202, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof AccountAccessDenied) {
      return Response.json({ error: "Run not found." }, { status: 404, headers: { "cache-control": "no-store" } });
    }
    if (error instanceof RunDirectiveCommandError && error.code === "run_terminal") {
      return Response.json({ error: error.message }, { status: 409, headers: { "cache-control": "no-store" } });
    }
    throw error;
  }
}
