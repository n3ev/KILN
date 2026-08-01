import { z } from "zod";

export const BillingInterval = z.enum(["week", "month", "year"]);
export type BillingInterval = z.infer<typeof BillingInterval>;

export const StripeEvent = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  created: z.number().int().nonnegative(),
  livemode: z.boolean(),
  data: z.object({ object: z.record(z.unknown()) }),
});
export type StripeEvent = z.infer<typeof StripeEvent>;

export interface CheckoutInput {
  readonly accountId: string;
  readonly planId: string;
  readonly planName: string;
  readonly priceWeeklyCents: number;
  readonly customerEmail: string;
  readonly customerId?: string;
  readonly interval: BillingInterval;
  readonly successUrl: string;
  readonly cancelUrl: string;
}

export interface CheckoutResult {
  readonly id: string;
  readonly url: string;
  readonly simulated: boolean;
}

export interface PortalInput {
  readonly customerId: string;
  readonly returnUrl: string;
}

export interface BillingAdapter {
  readonly kind: "mock" | "stripe";
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  createPortal(input: PortalInput): Promise<{ url: string; simulated: boolean }>;
  verifyWebhook(rawBody: string, signature: string): StripeEvent;
}

