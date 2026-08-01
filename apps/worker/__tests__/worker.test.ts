import {
  Entitlements,
  Scope,
} from "@kiln/contracts";
import {
  ConnectorProvider,
  EscrowScheduleReceipt,
  type EscrowScheduleRequest,
  type RotationRequest,
} from "@kiln/connectors";
import { MemoryJobQueue, workOnce, type JobQueue } from "@kiln/jobs";
import type { MirrorWriteResult, ReconcileOptions } from "@kiln/mirror";
import type { Logger } from "@kiln/observability";
import { describe, expect, it, vi } from "vitest";
import {
  JOB_NAMES,
  RunExecutePayload,
  createJobHandlers,
  runPoller,
  resolveRunGrants,
  sandboxQualityEvidence,
  livePublishBlockReason,
  type JobServices,
  type ParsedRunExecutePayload,
} from "../index.js";

const ids = {
  runId: "11111111-1111-4111-8111-111111111111",
  ventureId: "22222222-2222-4222-8222-222222222222",
  connectionId: "33333333-3333-4333-8333-333333333333",
  credentialId: "44444444-4444-4444-8444-444444444444",
  accountId: "55555555-5555-4555-8555-555555555555",
  stripeEventId: "evt_prompt_1_demo",
};

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};

function services() {
  const run = vi.fn(async (payload: ParsedRunExecutePayload) => ({
    runId: payload.runId,
    status: "succeeded" as const,
    artifacts: 12,
  }));
  const mirror = vi.fn(async (payload: ReconcileOptions): Promise<MirrorWriteResult> => ({
    connectionId: payload.connectionId,
    provider: "shopify",
    snapshots: 10,
    orders: 2,
    cursor: { through: payload.windowEnd ?? "2026-08-01T00:00:00.000Z" },
    reconciledThrough: payload.windowEnd ?? "2026-08-01T00:00:00.000Z",
  }));
  const rotation = vi.fn(async (_payload: RotationRequest) => ({ rotated: true }));
  const escrow = vi.fn(async (payload: EscrowScheduleRequest) =>
    EscrowScheduleReceipt.parse({
      scheduleKey: "a".repeat(64),
      mode: "mock",
      ventureId: payload.ventureId,
      scheduledFor: payload.scheduledFor,
      status: "scheduled",
    }),
  );
  const billing = vi.fn(async (_eventId: string) => true);
  const value: JobServices = {
    run: { execute: run },
    mirror: { reconcile: mirror },
    rotation: { rotate: rotation },
    escrow: { schedule: escrow },
    billing: { process: billing },
  };
  return { value, run, mirror, rotation, escrow, billing };
}

describe("worker job registry", () => {
  it("validates and dispatches every durable job type", async () => {
    const queue = new MemoryJobQueue();
    const fakes = services();
    const handlers = createJobHandlers({
      queue,
      services: fakes.value,
      heartbeatMs: 60_000,
      log: silentLogger,
    });
    const jobIds = await Promise.all([
      queue.enqueue(JOB_NAMES.runExecute, { runId: ids.runId }),
      queue.enqueue(JOB_NAMES.mirrorReconcile, {
        connectionId: ids.connectionId,
        windowDays: 5,
        windowEnd: "2026-08-01T00:00:00.000Z",
      }),
      queue.enqueue(JOB_NAMES.credentialRotate, {
        credentialId: ids.credentialId,
        accountId: ids.accountId,
        provider: "shopify",
      }),
      queue.enqueue(JOB_NAMES.escrowSchedule, {
        ventureId: ids.ventureId,
        accountId: ids.accountId,
        recipientPublicKey: "customer-public-key-material",
        scheduledFor: "2026-09-01T00:00:00.000Z",
      }),
      queue.enqueue(JOB_NAMES.billingStripeEvent, { eventId: ids.stripeEventId }),
    ]);

    for (let index = 0; index < jobIds.length; index++) {
      expect(await workOnce(queue, handlers)).toBe(true);
    }

    expect(fakes.run).toHaveBeenCalledWith({
      runId: ids.runId,
      autoApproveSandboxCheckpoints: true,
    });
    expect(fakes.mirror).toHaveBeenCalledOnce();
    expect(fakes.rotation).toHaveBeenCalledWith({
      credentialId: ids.credentialId,
      accountId: ids.accountId,
      provider: ConnectorProvider.parse("shopify"),
    });
    expect(fakes.escrow).toHaveBeenCalledOnce();
    expect(fakes.billing).toHaveBeenCalledWith(ids.stripeEventId);
    for (const id of jobIds) expect(queue.get(id)?.status).toBe("completed");
  });

  it("fails malformed payloads without invoking a service", async () => {
    const queue = new MemoryJobQueue();
    const fakes = services();
    const handlers = createJobHandlers({ queue, services: fakes.value, log: silentLogger });
    const id = await queue.enqueue(JOB_NAMES.runExecute, { runId: "not-a-uuid" }, { maxAttempts: 1 });

    await workOnce(queue, handlers);

    expect(queue.get(id)?.status).toBe("failed");
    expect(fakes.run).not.toHaveBeenCalled();
  });
});

describe("poller lifecycle", () => {
  it("stops claiming cleanly when shutdown is requested", async () => {
    const controller = new AbortController();
    let claims = 0;
    const queue: JobQueue = {
      enqueue: async () => ids.runId,
      claim: async () => {
        claims += 1;
        controller.abort("test shutdown");
        return undefined;
      },
      complete: async () => true,
      fail: async () => "lost",
      heartbeat: async () => true,
    };

    await runPoller({
      queue,
      handlers: {},
      signal: controller.signal,
      pollIntervalMs: 1,
      log: silentLogger,
    });

    expect(claims).toBe(1);
  });
});

describe("run adapter seams", () => {
  it("fails live publication closed until KYC and manual review are clear", () => {
    expect(livePublishBlockReason(undefined)).toBe("account-unavailable");
    expect(livePublishBlockReason({ kycStatus: "pending", pendingReviews: 0 })).toBe("kyc-required");
    expect(livePublishBlockReason({ kycStatus: "rejected", pendingReviews: 0 })).toBe("kyc-rejected");
    expect(livePublishBlockReason({ kycStatus: "verified", pendingReviews: 1 })).toBe("manual-review");
    expect(livePublishBlockReason({ kycStatus: "verified", pendingReviews: 0 })).toBeUndefined();
  });

  it("defaults sandbox run jobs to explicit simulated checkpoint approval", () => {
    expect(RunExecutePayload.parse({ runId: ids.runId }).autoApproveSandboxCheckpoints).toBe(true);
  });

  it("provides complete deterministic sandbox QA probes", () => {
    expect(sandboxQualityEvidence()).toEqual(sandboxQualityEvidence());
    expect(sandboxQualityEvidence().probes?.lighthouse).toHaveLength(3);
    expect(sandboxQualityEvidence().probes?.testTransaction).toMatchObject({
      completed: true,
      refunded: true,
    });
  });

  it("narrows run grants through plan entitlements", () => {
    const entitlements = Entitlements.parse({
      schemaVersion: 1,
      "ventures.max": 1,
      "autonomy.max": "guided",
      "credits.weekly": 10,
      "model.tier.max": "standard",
      "playbooks.allowed": ["physical-shopify"],
      "scopes.granted": ["research:read", "run:artifacts"],
      "support.tier": "community",
      "handover.included": false,
      "lane.priority": false,
    });
    expect(resolveRunGrants({
      accountId: ids.accountId,
      entitlements,
      playbookId: "physical-shopify",
      autonomy: "guided",
      requiredScopes: Scope.array().parse(["research:read", "commerce:write", "run:artifacts"]),
    })).toEqual(["research:read", "run:artifacts"]);
    expect(() => resolveRunGrants({
      accountId: ids.accountId,
      entitlements,
      playbookId: "digital-product",
      autonomy: "guided",
      requiredScopes: [],
    })).toThrow(/not entitled to playbook/);
  });
});
