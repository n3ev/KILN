import { describe, expect, it } from "vitest";
import { POST as connectorWebhook } from "../app/api/connectors/[provider]/webhook/route.js";
import { GET as trpcGet, POST as trpcPost } from "../app/api/trpc/[trpc]/route.js";

describe("prompt-2 API boundaries", () => {
  it("rejects generic connector payloads without consuming them", async () => {
    const request = new Request("https://kiln.test/api/connectors/shopify/webhook", {
      method: "POST",
      body: "unverified-payload",
    });

    const response = await connectorWebhook(request, { params: Promise.resolve({ provider: "shopify" }) });

    expect(response.status).toBe(501);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(request.bodyUsed).toBe(false);
    await expect(response.json()).resolves.toMatchObject({
      accepted: false,
      error: { code: "PROMPT_2_CONNECTOR_WEBHOOK_DISABLED" },
    });
  });

  it("keeps both tRPC transports closed", async () => {
    const postRequest = new Request("https://kiln.test/api/trpc/venture.list", {
      method: "POST",
      body: "{}",
    });
    const [getResponse, postResponse] = await Promise.all([trpcGet(), trpcPost(postRequest)]);

    expect(getResponse.status).toBe(501);
    expect(postResponse.status).toBe(501);
    expect(postRequest.bodyUsed).toBe(false);
    await expect(getResponse.json()).resolves.toMatchObject({
      error: { code: "PROMPT_2_TRPC_DISABLED" },
    });
  });
});
