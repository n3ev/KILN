/**
 * Prompt-2 boundary for the generic tRPC transport.
 *
 * Current prompt-1 APIs are explicit route handlers. Returning a hard 501 is
 * safer than exposing an empty or unauthenticated router by accident.
 */
export const dynamic = "force-dynamic";

function promptTwoResponse(): Response {
  return Response.json(
    {
      error: {
        code: "PROMPT_2_TRPC_DISABLED",
        message: "The tRPC transport is not enabled in this release.",
      },
    },
    {
      status: 501,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export async function GET(): Promise<Response> {
  return promptTwoResponse();
}

export async function POST(request: Request): Promise<Response> {
  void request;
  return promptTwoResponse();
}
