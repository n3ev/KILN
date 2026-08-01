import { BreakGlassPublicKeyRequest } from "@kiln/contracts";
import { getHandoverSummary, HandoverCommandError, registerBreakGlassPublicKey } from "../../../../lib/handover";
import { enforceMutationRateLimit } from "../../../../lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const summary = await getHandoverSummary();
  return Response.json(summary.key, { headers: { "cache-control": "no-store" } });
}

export async function PUT(request: Request): Promise<Response> {
  const limited = await enforceMutationRateLimit(request, "handover.key", { accountLimit: 8, ipLimit: 5 });
  if (limited) return limited;
  const parsed = BreakGlassPublicKeyRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Supply an X25519 public key only.", issues: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const registration = await registerBreakGlassPublicKey(parsed.data);
    return Response.json(registration, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof HandoverCommandError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status, headers: { "cache-control": "no-store" } });
    }
    throw error;
  }
}
