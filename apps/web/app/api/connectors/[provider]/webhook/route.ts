/**
 * Prompt-2 boundary for generic connector webhooks.
 *
 * This endpoint deliberately does not read, log, acknowledge, or enqueue the
 * request body. A provider must not receive a 2xx until its adapter verifies
 * signatures, rejects replays, and supplies ordered venture processing.
 */
export const dynamic = "force-dynamic";

export interface ConnectorWebhookContext {
  readonly params: Promise<{ provider: string }>;
}

export async function POST(request: Request, context: ConnectorWebhookContext): Promise<Response> {
  void request;
  void context;

  return Response.json(
    {
      accepted: false,
      error: {
        code: "PROMPT_2_CONNECTOR_WEBHOOK_DISABLED",
        message: "Generic connector webhooks are not enabled in this release.",
      },
    },
    {
      status: 501,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
