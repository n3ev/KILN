import { CredentialUnavailable, EgressBlocked } from "@kiln/contracts";
import { describe, expect, it, vi } from "vitest";
import { createEgressClient } from "../egress.js";

const handle = {
  id: "lease-1",
  provider: "shopify",
  expiresAt: "2026-08-01T00:05:00.000Z",
};

describe("controlled egress", () => {
  it("resolves an opaque credential only inside the request callback", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer secret-token");
      return new Response("ok", { status: 200 });
    });
    let released = false;
    const client = createEgressClient({
      allowlist: ["api.example.test"],
      resolveHost: async () => ["203.0.113.20"],
      fetchImpl,
      credentialResolver: {
        use: async (_handle, operation) => {
          try {
            return await operation("secret-token");
          } finally {
            released = true;
          }
        },
      },
    });

    await expect(client.fetch("https://api.example.test/orders", { handle })).resolves.toMatchObject({ status: 200 });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(released).toBe(true);
  });

  it("refuses to silently discard a credential handle", async () => {
    const client = createEgressClient({
      allowlist: ["api.example.test"],
      resolveHost: async () => ["203.0.113.20"],
      fetchImpl: async () => new Response(null, { status: 204 }),
    });

    await expect(client.fetch("https://api.example.test/orders", { handle })).rejects.toBeInstanceOf(
      CredentialUnavailable,
    );
  });

  it("never sends credentials to an arbitrary or private host", async () => {
    const client = createEgressClient({
      allowlist: ["api.example.test"],
      allowArbitraryPublicHosts: true,
      resolveHost: async () => ["169.254.169.254"],
      credentialResolver: { use: async (_handle, operation) => operation("secret-token") },
    });

    await expect(client.fetch("https://metadata.example.test/latest", { handle })).rejects.toBeInstanceOf(
      EgressBlocked,
    );
  });
});
