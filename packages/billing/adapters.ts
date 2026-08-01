import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { config } from "@kiln/config";
import { z } from "zod";
import { StripeEvent, type BillingAdapter, type CheckoutInput, type CheckoutResult, type PortalInput } from "./types.js";

const SessionResponse = z.object({ id: z.string().min(1), url: z.string().url().nullable().optional() });

function stableId(prefix: string, value: unknown): string {
  return `${prefix}_${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24)}`;
}

function priceForInterval(weeklyCents: number, interval: CheckoutInput["interval"]): number {
  if (interval === "week") return weeklyCents;
  if (interval === "month") return Math.round((weeklyCents * 52 * 0.9) / 12);
  return Math.round(weeklyCents * 52 * 0.8);
}

function parseSignature(signature: string): { timestamp: string; signatures: string[] } {
  const fields = signature.split(",").map((part) => part.trim().split("=", 2));
  const timestamp = fields.find(([key]) => key === "t")?.[1];
  const signatures = fields.filter(([key]) => key === "v1").flatMap(([, value]) => value ? [value] : []);
  if (!timestamp || signatures.length === 0) throw new Error("Malformed Stripe-Signature header");
  return { timestamp, signatures };
}

function verifyHmac(rawBody: string, signature: string, secret: string, toleranceSeconds: number): void {
  if (!secret) throw new Error("Stripe webhook secret is not configured");
  const parsed = parseSignature(signature);
  const age = Math.abs(Math.floor(Date.now() / 1_000) - Number(parsed.timestamp));
  if (!Number.isFinite(age) || age > toleranceSeconds) throw new Error("Stripe webhook timestamp is outside tolerance");
  const expected = createHmac("sha256", secret).update(`${parsed.timestamp}.${rawBody}`).digest("hex");
  const expectedBytes = Buffer.from(expected, "hex");
  const valid = parsed.signatures.some((candidate) => {
    const actual = Buffer.from(candidate, "hex");
    return actual.length === expectedBytes.length && timingSafeEqual(actual, expectedBytes);
  });
  if (!valid) throw new Error("Stripe webhook signature verification failed");
}

export class MockBillingAdapter implements BillingAdapter {
  readonly kind = "mock" as const;
  readonly #secret: string;

  constructor(secret = "kiln-local-webhook-secret") {
    this.#secret = secret;
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const id = stableId("cs_test", input);
    return { id, url: `${input.successUrl}?mock_checkout=${id}`, simulated: true };
  }

  async createPortal(input: PortalInput): Promise<{ url: string; simulated: boolean }> {
    const id = stableId("bps_test", input);
    return { url: `${input.returnUrl}?mock_portal=${id}`, simulated: true };
  }

  verifyWebhook(rawBody: string, signature: string): StripeEvent {
    verifyHmac(rawBody, signature, this.#secret, 300);
    return StripeEvent.parse(JSON.parse(rawBody));
  }

  signWebhook(rawBody: string, timestamp = Math.floor(Date.now() / 1_000)): string {
    const signature = createHmac("sha256", this.#secret).update(`${timestamp}.${rawBody}`).digest("hex");
    return `t=${timestamp},v1=${signature}`;
  }
}

export interface StripeBillingAdapterOptions {
  readonly secretKey: string;
  readonly webhookSecret: string;
  readonly fetch?: typeof globalThis.fetch;
}

export class StripeBillingAdapter implements BillingAdapter {
  readonly kind = "stripe" as const;
  readonly #secretKey: string;
  readonly #webhookSecret: string;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: StripeBillingAdapterOptions) {
    this.#secretKey = options.secretKey;
    this.#webhookSecret = options.webhookSecret;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async #post(path: string, body: URLSearchParams): Promise<z.infer<typeof SessionResponse>> {
    const response = await this.#fetch(`https://api.stripe.com/v1/${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.#secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      const message = z.object({ error: z.object({ message: z.string() }) }).safeParse(payload);
      throw new Error(message.success ? message.data.error.message : `Stripe request failed (${response.status})`);
    }
    return SessionResponse.parse(payload);
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const body = new URLSearchParams({
      mode: "subscription",
      client_reference_id: input.accountId,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      "metadata[kiln_account_id]": input.accountId,
      "metadata[kiln_plan_id]": input.planId,
      "subscription_data[metadata][kiln_account_id]": input.accountId,
      "subscription_data[metadata][kiln_plan_id]": input.planId,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(priceForInterval(input.priceWeeklyCents, input.interval)),
      "line_items[0][price_data][product_data][name]": `KILN ${input.planName}`,
      "line_items[0][price_data][recurring][interval]": input.interval,
      "automatic_tax[enabled]": "true",
      "tax_id_collection[enabled]": "true",
      allow_promotion_codes: "true",
    });
    if (input.customerId) body.set("customer", input.customerId);
    else body.set("customer_email", input.customerEmail);
    const session = await this.#post("checkout/sessions", body);
    if (!session.url) throw new Error("Stripe checkout session returned no URL");
    return { id: session.id, url: session.url, simulated: false };
  }

  async createPortal(input: PortalInput): Promise<{ url: string; simulated: boolean }> {
    const session = await this.#post(
      "billing_portal/sessions",
      new URLSearchParams({ customer: input.customerId, return_url: input.returnUrl }),
    );
    if (!session.url) throw new Error("Stripe portal session returned no URL");
    return { url: session.url, simulated: false };
  }

  verifyWebhook(rawBody: string, signature: string): StripeEvent {
    verifyHmac(rawBody, signature, this.#webhookSecret, 300);
    return StripeEvent.parse(JSON.parse(rawBody));
  }
}

export function createBillingAdapter(): BillingAdapter {
  const env = config();
  return env.STRIPE_SECRET_KEY
    ? new StripeBillingAdapter({
        secretKey: env.STRIPE_SECRET_KEY,
        webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? "",
      })
    : new MockBillingAdapter();
}

