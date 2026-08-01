import { createBillingAdapter, receiveStripeWebhook } from "@kiln/billing";
import { PostgresJobQueue } from "@kiln/jobs";

export const dynamic = "force-dynamic";

const queue = new PostgresJobQueue({ workerId: "web-stripe-inbox" });

export async function POST(request: Request): Promise<Response> {
  const signature = request.headers.get("stripe-signature") ?? "";
  const rawBody = await request.text();
  try {
    const receipt = await receiveStripeWebhook(rawBody, signature, queue, createBillingAdapter());
    return Response.json({ received: true, replayed: receipt.replayed }, { status: 200 });
  } catch (error) {
    return Response.json(
      { received: false, error: error instanceof Error ? error.message : "Invalid webhook" },
      { status: 400 },
    );
  }
}

