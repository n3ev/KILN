import { randomUUID } from "node:crypto";
import { SpendAuthorisation, UnauthorisedSpend } from "@kiln/contracts";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineTool, type ToolContext } from "../define.js";
import { invokeTool, type PipelineDeps, type ToolCallRecord } from "../pipeline.js";
import { ToolRegistry } from "../registry.js";

const runId = randomUUID();

const context = (sandbox: boolean): ToolContext => ({
  runId,
  ventureId: randomUUID(),
  accountId: randomUUID(),
  agentId: "supply-officer",
  seed: "pipeline-test",
  sandbox,
  grantedScopes: ["supply:order", "spend:external"],
  lease: async () => ({ id: "lease_test", provider: "test", expiresAt: new Date(Date.now() + 60_000).toISOString() }),
  http: { fetch: async () => new Response(null, { status: 204 }) },
  logger: { debug() {}, info() {}, warn() {} },
});

const spendTool = defineTool({
  id: "test.sample.commit",
  version: "1.0.0",
  title: "Commit test spend",
  description:
    "Commits a quoted test purchase. It requires a matching one-shot authorisation and reports the amount actually paid.",
  scopes: ["supply:order", "spend:external"],
  sideEffect: "spend",
  input: z.object({ quoteId: z.string(), currency: z.enum(["GBP", "USD"]), paidMicros: z.number().int() }),
  output: z.object({ receiptId: z.string(), paidMicros: z.number().int() }),
  costEstimate: (input) => input.paidMicros,
  idempotent: true,
  timeoutMs: 100,
  retry: { attempts: 1, backoffMs: 1 },
  async execute(input) {
    return { receiptId: "live_receipt", paidMicros: input.paidMicros };
  },
  async simulate(input) {
    return { receiptId: "sim_receipt", paidMicros: input.paidMicros };
  },
});

function authorisation(overrides: Record<string, unknown> = {}) {
  return SpendAuthorisation.parse({
    id: randomUUID(),
    runId,
    purpose: "Order one supplier sample",
    ceilingMicros: 150_000,
    currency: "GBP",
    quoteId: "quote_1",
    category: "external",
    standing: false,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  });
}

function dependencies(auth = authorisation()) {
  const records: ToolCallRecord[] = [];
  const consumed: { id: string; toolCallId: string }[] = [];
  const budgetEvents: string[] = [];
  const deps: PipelineDeps = {
    registry: new ToolRegistry().register(spendTool),
    agentAllowlist: [spendTool.id],
    grantedScopes: ["supply:order", "spend:external"],
    findCompleted: async (key) => records.find((record) => record.idempotencyKey === key && record.status === "succeeded"),
    persist: async (record) => void records.push(record),
    emit: async () => undefined,
    requestApproval: async () => ({ approved: true }),
    approvalCoveredByAutonomy: () => true,
    budget: {
      reserve: async (_category, micros) => void budgetEvents.push(`reserve:${micros}`),
      settle: async (_ref, micros) => void budgetEvents.push(`settle:${micros}`),
      release: async () => void budgetEvents.push("release"),
    },
    findAuthorisation: async (id) => (id === auth.id ? auth : undefined),
    consumeAuthorisation: async (id, toolCallId) => void consumed.push({ id, toolCallId }),
  };
  return { deps, records, consumed, budgetEvents };
}

describe("spend authorisation", () => {
  it("forces a fresh confirmation after untrusted content even under autonomy", async () => {
    const auth = authorisation();
    const { deps } = dependencies(auth);
    const requestApproval = vi.fn(async () => ({ approved: true }));
    const guardedDeps: PipelineDeps = { ...deps, requestApproval };

    await invokeTool(guardedDeps, {
      toolId: spendTool.id,
      authorisationId: auth.id,
      input: { quoteId: "quote_1", currency: "GBP", paidMicros: 100_000 },
      ctx: { ...context(true), untrustedContentIngested: true },
    });

    expect(requestApproval).toHaveBeenCalledWith(expect.objectContaining({ reason: "untrusted_content" }));
  });

  // Named for what it enumerates: one fixture tool. The guarantee is broader —
  // invokeTool rejects structurally, so it holds for every tool routed through
  // the pipeline — but this test does not walk the catalogue.
  it("refuses a spend-effect tool without an authorisation", async () => {
    const { deps, records } = dependencies();
    await expect(
      invokeTool(deps, {
        toolId: spendTool.id,
        input: { quoteId: "quote_1", currency: "GBP", paidMicros: 100_000 },
        ctx: context(true),
      }),
    ).rejects.toBeInstanceOf(UnauthorisedSpend);
    expect(records).toHaveLength(0);
  });

  it("rejects an authorisation issued to another run", async () => {
    const auth = authorisation({ runId: randomUUID() });
    const { deps } = dependencies(auth);
    await expect(
      invokeTool(deps, {
        toolId: spendTool.id,
        authorisationId: auth.id,
        input: { quoteId: "quote_1", currency: "GBP", paidMicros: 100_000 },
        ctx: context(true),
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORISED_SPEND" });
  });

  it("rejects an already-consumed one-shot authorisation", async () => {
    const auth = authorisation({ consumedByToolCallId: randomUUID() });
    const { deps } = dependencies(auth);
    await expect(
      invokeTool(deps, {
        toolId: spendTool.id,
        authorisationId: auth.id,
        input: { quoteId: "quote_1", currency: "GBP", paidMicros: 100_000 },
        ctx: context(true),
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORISED_SPEND" });
  });

  it("reserves the ceiling and consumes a successful one-shot authorisation", async () => {
    const auth = authorisation();
    const { deps, consumed, budgetEvents } = dependencies(auth);
    const result = await invokeTool(deps, {
      toolId: spendTool.id,
      authorisationId: auth.id,
      input: { quoteId: "quote_1", currency: "GBP", paidMicros: 120_000 },
      ctx: context(false),
    });
    expect(result).toEqual({ receiptId: "live_receipt", paidMicros: 120_000 });
    expect(budgetEvents).toEqual(["reserve:150000", "settle:120000"]);
    expect(consumed).toHaveLength(1);
    expect(consumed[0]?.id).toBe(auth.id);
  });
});

describe("timeouts", () => {
  it("aborts the attempt signal before reporting a timeout", async () => {
    const sawAbort = vi.fn();
    const slow = defineTool({
      id: "test.slow.write",
      version: "1.0.0",
      title: "Slow write",
      description:
        "Exercises timeout cancellation by waiting until the pipeline aborts the attempt-specific signal.",
      scopes: [],
      sideEffect: "write",
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      idempotent: true,
      timeoutMs: 10,
      retry: { attempts: 1, backoffMs: 1 },
      execute: async (_input, ctx) =>
        new Promise((resolve) => {
          ctx.signal?.addEventListener("abort", () => {
            sawAbort();
            resolve({ ok: false });
          });
        }),
      simulate: async () => ({ ok: true }),
    });
    const records: ToolCallRecord[] = [];
    const deps: PipelineDeps = {
      ...dependencies().deps,
      registry: new ToolRegistry().register(slow),
      agentAllowlist: [slow.id],
      grantedScopes: [],
      persist: async (record) => void records.push(record),
    };
    await expect(invokeTool(deps, { toolId: slow.id, input: {}, ctx: { ...context(false), grantedScopes: [] } })).rejects.toMatchObject({
      code: "TOOL_TIMEOUT",
    });
    expect(sawAbort).toHaveBeenCalledOnce();
    expect(records.at(-1)?.status).toBe("failed");
  });
});
