import {
  MockConnector,
  createConnectorRegistry,
  type ReconciliationBatch,
} from "@kiln/connectors";
import { describe, expect, it } from "vitest";
import {
  MirrorReconciler,
  dimensionsHash,
  type MirrorConnection,
  type MirrorStore,
  type MirrorWriteResult,
} from "../index.js";

const connection: MirrorConnection = {
  id: "22222222-2222-4222-8222-222222222222",
  ventureId: "11111111-1111-4111-8111-111111111111",
  provider: "shopify",
  status: "healthy",
  cursor: {},
  lastSyncAt: null,
};

class RecordingStore implements MirrorStore {
  readonly batches: ReconciliationBatch[] = [];
  readonly failures: unknown[] = [];

  async loadConnection(id: string): Promise<MirrorConnection | undefined> {
    return id === connection.id ? connection : undefined;
  }

  async persistBatch(
    current: MirrorConnection,
    batch: ReconciliationBatch,
  ): Promise<MirrorWriteResult> {
    this.batches.push(batch);
    return {
      connectionId: current.id,
      provider: current.provider,
      snapshots: batch.snapshots.length,
      orders: batch.orders.length,
      cursor: batch.nextCursor,
      reconciledThrough: batch.windowEnd,
    };
  }

  async markFailure(_connectionId: string, error: unknown): Promise<void> {
    this.failures.push(error);
  }
}

describe("mirror reconciliation", () => {
  it("normalises dimension hashes independently of object key order", () => {
    expect(dimensionsHash({ channel: "search", country: "AU" })).toBe(
      dimensionsHash({ country: "AU", channel: "search" }),
    );
    expect(dimensionsHash({ country: "NZ" })).not.toBe(dimensionsHash({ country: "AU" }));
  });

  it("runs a deterministic rolling-window mock batch through the store", async () => {
    const store = new RecordingStore();
    const reconciler = new MirrorReconciler({
      connectors: createConnectorRegistry(),
      store,
      sandbox: true,
      now: () => "2026-08-01T00:00:00.000Z",
    });

    const first = await reconciler.reconcile({ connectionId: connection.id, windowDays: 3 });
    const second = await reconciler.reconcile({ connectionId: connection.id, windowDays: 3 });

    expect(first).toEqual(second);
    expect(store.batches[0]).toEqual(store.batches[1]);
    expect(first.snapshots).toBeGreaterThan(0);
    expect(first.orders).toBeGreaterThan(0);
  });

  it("marks connection health when an adapter fails", async () => {
    const store = new RecordingStore();
    const connectors = createConnectorRegistry();
    const base = new MockConnector("shopify");
    connectors.register({
      mode: "mock",
      provider: "shopify",
      rotation: "supported",
      reconcile: async () => {
        throw new Error("fixture failure");
      },
      issueRotationCredential: (request) => base.issueRotationCredential(request),
      verifyRotationCredential: (secret, request) =>
        base.verifyRotationCredential(secret, request),
    });
    const reconciler = new MirrorReconciler({ connectors, store, sandbox: true });

    await expect(reconciler.reconcile({ connectionId: connection.id })).rejects.toThrow("fixture failure");
    expect(store.failures).toHaveLength(1);
  });
});
