import { describe, expect, it, vi } from "vitest";
import { MockBillingAdapter, StripeBillingAdapter } from "../adapters.js";
import type { CheckoutInput, StripeEvent } from "../types.js";

const checkout: CheckoutInput = {
  accountId: "00000000-0000-4000-8000-000000000001",
  planId: "00000000-0000-4000-8000-000000000002",
  planName: "Founder",
  priceWeeklyCents: 19_900,
  customerEmail: "owner@example.test",
  interval: "week",
  successUrl: "https://app.example.test/success",
  cancelUrl: "https://app.example.test/cancel",
};

const event: StripeEvent = {
  id: "evt_test_1",
  type: "checkout.session.completed",
  created: Math.floor(Date.now() / 1_000),
  livemode: false,
  data: { object: { client_reference_id: checkout.accountId } },
};

describe("billing adapters", () => {
  it("produces deterministic local checkout URLs", async () => {
    const adapter = new MockBillingAdapter();
    expect(await adapter.createCheckout(checkout)).toEqual(await adapter.createCheckout(checkout));
    expect((await adapter.createCheckout(checkout)).simulated).toBe(true);
    expect(
      await adapter.createPortal({ customerId: "cus_mock", returnUrl: "https://app.example.test/billing" }),
    ).toMatchObject({ simulated: true, url: expect.stringContaining("mock_portal=") });
  });

  it("verifies mock webhooks and rejects tampering", () => {
    const adapter = new MockBillingAdapter("test-secret");
    const raw = JSON.stringify(event);
    const signature = adapter.signWebhook(raw);
    expect(adapter.verifyWebhook(raw, signature).id).toBe(event.id);
    expect(() => adapter.verifyWebhook(`${raw} `, signature)).toThrow(/signature verification failed/);
    expect(() => adapter.verifyWebhook(raw, "not-a-stripe-signature")).toThrow(/Malformed Stripe-Signature/);
    expect(() => adapter.verifyWebhook(raw, adapter.signWebhook(raw, 1))).toThrow(/outside tolerance/);
  });

  it("creates a weekly Stripe subscription with automatic tax", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body as URLSearchParams;
      expect(body.get("mode")).toBe("subscription");
      expect(body.get("line_items[0][price_data][recurring][interval]")).toBe("week");
      expect(body.get("line_items[0][price_data][unit_amount]")).toBe("19900");
      expect(body.get("automatic_tax[enabled]")).toBe("true");
      return new Response(JSON.stringify({ id: "cs_test_live", url: "https://checkout.stripe.test/session" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const adapter = new StripeBillingAdapter({
      secretKey: "sk_test_example",
      webhookSecret: "whsec_example",
      fetch: fetchMock,
    });
    expect(await adapter.createCheckout(checkout)).toMatchObject({ id: "cs_test_live", simulated: false });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    ["month", "77610"],
    ["year", "827840"],
  ] as const)("converts weekly pricing for a %s subscription", async (interval, amount) => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body as URLSearchParams;
      expect(body.get("line_items[0][price_data][unit_amount]")).toBe(amount);
      expect(body.get("customer_email")).toBe(checkout.customerEmail);
      return Response.json({ id: `cs_${interval}`, url: "https://checkout.stripe.test/session" });
    });
    const adapter = new StripeBillingAdapter({ secretKey: "sk_test", webhookSecret: "whsec_test", fetch: fetchMock });
    await adapter.createCheckout({ ...checkout, interval });
  });

  it("uses a customer id and creates billing portal sessions", async () => {
    const requests: { url: string; body: URLSearchParams }[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), body: init?.body as URLSearchParams });
      return Response.json({ id: "session_1", url: "https://billing.stripe.test/session" });
    });
    const adapter = new StripeBillingAdapter({ secretKey: "sk_test", webhookSecret: "whsec_test", fetch: fetchMock });
    await adapter.createCheckout({ ...checkout, customerId: "cus_existing" });
    expect(requests[0]?.body.get("customer")).toBe("cus_existing");
    expect(requests[0]?.body.has("customer_email")).toBe(false);

    await expect(
      adapter.createPortal({ customerId: "cus_existing", returnUrl: "https://app.example.test/billing" }),
    ).resolves.toEqual({ url: "https://billing.stripe.test/session", simulated: false });
    expect(requests[1]?.url).toContain("billing_portal/sessions");
  });

  it("surfaces Stripe errors and refuses sessions without a URL", async () => {
    const stripeError = new StripeBillingAdapter({
      secretKey: "sk_test",
      webhookSecret: "whsec_test",
      fetch: async () => Response.json({ error: { message: "card setup failed" } }, { status: 402 }),
    });
    await expect(stripeError.createCheckout(checkout)).rejects.toThrow("card setup failed");

    const genericError = new StripeBillingAdapter({
      secretKey: "sk_test",
      webhookSecret: "whsec_test",
      fetch: async () => Response.json({ unexpected: true }, { status: 500 }),
    });
    await expect(genericError.createCheckout(checkout)).rejects.toThrow("Stripe request failed (500)");

    const missingUrl = new StripeBillingAdapter({
      secretKey: "sk_test",
      webhookSecret: "whsec_test",
      fetch: async () => Response.json({ id: "session_without_url", url: null }),
    });
    await expect(missingUrl.createCheckout(checkout)).rejects.toThrow("returned no URL");
    await expect(
      missingUrl.createPortal({ customerId: "cus_existing", returnUrl: "https://app.example.test/billing" }),
    ).rejects.toThrow("returned no URL");
  });
});
