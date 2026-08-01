import { describe, expect, it } from "vitest";
import {
  LiveConnectorUnavailable,
  LiveEscrowSchedulerStub,
  MockConnector,
  MockEscrowScheduler,
  createConnectorRegistry,
} from "../index.js";

const ids = {
  ventureId: "11111111-1111-4111-8111-111111111111",
  connectionId: "22222222-2222-4222-8222-222222222222",
  credentialId: "33333333-3333-4333-8333-333333333333",
  accountId: "44444444-4444-4444-8444-444444444444",
};

describe("mock connectors", () => {
  it("reconciles the same rolling window byte-for-byte deterministically", async () => {
    const connector = new MockConnector("shopify");
    const request = {
      ventureId: ids.ventureId,
      connectionId: ids.connectionId,
      provider: "shopify" as const,
      windowStart: "2026-07-28T00:00:00.000Z",
      windowEnd: "2026-08-01T00:00:00.000Z",
      cursor: {},
    };

    const first = await connector.reconcile(request);
    const second = await connector.reconcile(request);

    expect(second).toEqual(first);
    expect(first.snapshots.length).toBeGreaterThan(0);
    expect(first.orders.length).toBeGreaterThan(0);
    expect(first.orders.every((order) => !("email" in order))).toBe(true);
  });

  it("issues and verifies deterministic mock rotations", async () => {
    const connector = new MockConnector("shopify");
    const request = { ...ids, provider: "shopify" as const };
    const secret = await connector.issueRotationCredential(request);

    expect(await connector.issueRotationCredential(request)).toBe(secret);
    expect(await connector.verifyRotationCredential(secret, request)).toBe(true);
    expect(await connector.verifyRotationCredential("wrong", request)).toBe(false);
  });

  it("routes sandbox and live modes explicitly", async () => {
    const registry = createConnectorRegistry();
    expect(registry.resolve("stripe", true).mode).toBe("mock");
    await expect(
      registry.resolve("stripe", false).reconcile({
        ventureId: ids.ventureId,
        connectionId: ids.connectionId,
        provider: "stripe",
        windowStart: "2026-07-31T00:00:00.000Z",
        windowEnd: "2026-08-01T00:00:00.000Z",
        cursor: {},
      }),
    ).rejects.toThrow(/TODO\(prompt-4\)/);
  });
});

describe("escrow scheduling seam", () => {
  const request = {
    ventureId: ids.ventureId,
    accountId: ids.accountId,
    recipientPublicKey: "customer-public-key-material",
    scheduledFor: "2026-09-01T00:00:00.000Z",
  };

  it("is deterministic in mock mode", async () => {
    const scheduler = new MockEscrowScheduler();
    expect(await scheduler.schedule(request)).toEqual(await scheduler.schedule(request));
  });

  it("keeps the live prompt-5 path explicit", async () => {
    await expect(new LiveEscrowSchedulerStub().schedule(request)).rejects.toBeInstanceOf(
      LiveConnectorUnavailable,
    );
  });
});
