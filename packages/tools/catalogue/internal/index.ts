import { ArtifactType } from "@kiln/contracts";
import { z } from "zod";
import { contentHash } from "../../core/canonical.js";
import { defineTool, type AnyTool } from "../../core/define.js";
import { fakeId, isoFor, isoNow, seedFor } from "../_helpers.js";

/**
 * Internal tools — run mechanics rather than the outside world.
 *
 * These are the only tools granted to every agent by default (scope
 * `run:artifacts` / `run:checkpoints` / `run:notify`), because an agent that
 * cannot write its output or ask a question cannot do its job. They still go
 * through the full pipeline: an artifact write is audited and idempotent like
 * any other side effect.
 *
 * The runtime injects real implementations for these at run start; the
 * definitions here own the contract, the description, and the simulation.
 */

export const artifactWrite = defineTool({
  id: "artifact.write",
  version: "1.0.0",
  title: "Write an artifact",
  description:
    "Persists a durable, versioned output — a memo, a token set, a catalogue, a policy. " +
    "Content is validated against the schema its `type` declares and rejected if it does not " +
    "match, so fix the content rather than changing the type. Artifacts are immutable: " +
    "writing the same type again creates a new version and supersedes the old one, it does " +
    "not edit in place. Include a `sources` array for anything containing quantitative or " +
    "market claims; artifacts with unsourced figures are rejected by the critic.",
  scopes: ["run:artifacts"],
  sideEffect: "write",
  input: z.object({
    type: ArtifactType,
    content: z.unknown(),
    sources: z.array(z.unknown()).default([]),
    supersedes: z.string().uuid().optional(),
  }),
  output: z.object({
    artifactId: z.string(),
    type: ArtifactType,
    version: z.number().int().positive(),
    contentHash: z.string().length(64),
  }),
  idempotent: true,
  timeoutMs: 15_000,
  async execute() {
    // Replaced at run start by the runtime, which owns the DB handle.
    throw new Error("artifact.write must be bound by the runtime before use.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "artifact.write", input.type);
    return {
      artifactId: fakeId(rng, "art", 16),
      type: input.type,
      version: 1,
      contentHash: contentHash(input.content),
    };
  },
});

export const artifactRead = defineTool({
  id: "artifact.read",
  version: "1.0.0",
  title: "Read an artifact",
  description:
    "Reads the latest accepted version of an artifact produced earlier in this run. Use it " +
    "to pull an upstream dependency you were not given directly in context. Returns null when " +
    "the artifact does not exist yet, which means the phase that produces it has not run — " +
    "that is a planning problem, not something to retry.",
  scopes: ["run:artifacts"],
  sideEffect: "read",
  input: z.object({ type: ArtifactType, version: z.number().int().positive().optional() }),
  output: z.object({ found: z.boolean(), content: z.unknown().nullable(), version: z.number().int().nullable() }),
  idempotent: true,
  timeoutMs: 10_000,
  async execute() {
    throw new Error("artifact.read must be bound by the runtime before use.");
  },
  async simulate() {
    return { found: false, content: null, version: null };
  },
});

export const memoAppend = defineTool({
  id: "memo.append",
  version: "1.0.0",
  title: "Append to the run memo",
  description:
    "Records one decision and the reasoning behind it in the rolling run memo, which every " +
    "later agent receives in context. Append a line whenever you make a choice a downstream " +
    "agent would otherwise have to re-derive or might contradict — a price point, a rejected " +
    "supplier, a positioning trade-off. The memo is capped at roughly 2,000 tokens and older " +
    "entries are compacted, so write the decision and its reason, not the deliberation.",
  scopes: ["run:artifacts"],
  sideEffect: "write",
  input: z.object({
    phase: z.string().min(1),
    decision: z.string().min(1).max(300),
    rationale: z.string().min(1).max(500),
  }),
  output: z.object({ entries: z.number().int().nonnegative(), approxTokens: z.number().int().nonnegative() }),
  idempotent: false,
  timeoutMs: 10_000,
  async execute() {
    throw new Error("memo.append must be bound by the runtime before use.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "memo.append", input.decision);
    return { entries: rng.int(1, 12), approxTokens: rng.int(80, 1900) };
  },
});

export const checkpointRequest = defineTool({
  id: "checkpoint.request",
  version: "1.0.0",
  title: "Ask the customer a question",
  description:
    "Pauses the run and asks the customer to decide. Use it when the choice is genuinely " +
    "theirs — spending money, a brand direction, a trade-off between capital and speed — and " +
    "NOT to resolve something you could research or reason about yourself. Every option must " +
    "state its consequence in plain language. The run sleeps until they answer or the deadline " +
    "passes; under `autonomous` autonomy a hard gate becomes a 30-minute veto window instead " +
    "of a block. Returns the option the customer chose.",
  scopes: ["run:checkpoints"],
  sideEffect: "write",
  input: z.object({
    kind: z.enum([
      "hard_gate",
      "spend_authorisation",
      "quality_override",
      "reconnect",
      "archetype_ambiguous",
      "critic_escalation",
      "repair_escalation",
      "kill_recommendation",
    ]),
    title: z.string().min(1).max(120),
    question: z.string().min(1),
    context: z.string().min(1),
    options: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          description: z.string().min(1),
          consequence: z.string().min(1),
          recommended: z.boolean().default(false),
        }),
      )
      .min(2),
    expiresInHours: z.number().int().min(1).max(336).default(72),
  }),
  output: z.object({
    checkpointId: z.string(),
    status: z.enum(["pending", "approved", "rejected", "expired", "auto"]),
    chosenOptionId: z.string().nullable(),
    note: z.string().nullable(),
  }),
  idempotent: false,
  timeoutMs: 30_000,
  async execute() {
    throw new Error("checkpoint.request must be bound by the runtime before use.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "checkpoint.request", input.title);
    // Simulated runs auto-approve the recommended option so a demo completes.
    const recommended = input.options.find((o) => o.recommended) ?? input.options[0];
    return {
      checkpointId: fakeId(rng, "cp"),
      status: "auto" as const,
      chosenOptionId: recommended?.id ?? null,
      note: "Auto-approved in sandbox mode.",
    };
  },
});

export const taskSpawn = defineTool({
  id: "task.spawn",
  version: "1.0.0",
  title: "Spawn a sub-task",
  description:
    "Queues additional work for another agent within this run — a second competitor teardown, " +
    "a per-product copy pass. Use it to fan out repetitive work rather than doing twenty items " +
    "inside one invocation, which blows the context budget and degrades the last ones. The " +
    "spawned task is scheduled by the runtime and its artifact becomes available to later " +
    "phases; it does not run inline and you do not receive its result in this invocation.",
  scopes: ["run:artifacts"],
  sideEffect: "write",
  input: z.object({
    agentId: z.string().min(1),
    title: z.string().min(1),
    input: z.record(z.string(), z.unknown()),
  }),
  output: z.object({ taskId: z.string(), queued: z.boolean() }),
  idempotent: true,
  timeoutMs: 10_000,
  async execute() {
    throw new Error("task.spawn must be bound by the runtime before use.");
  },
  async simulate(input, ctx) {
    return { taskId: fakeId(seedFor(ctx, "task.spawn", input.title), "task"), queued: true };
  },
});

export const notifyCustomer = defineTool({
  id: "notify.customer",
  version: "1.0.0",
  title: "Notify the customer",
  description:
    "Sends the customer an informational message that does NOT block the run — a milestone, a " +
    "finding worth knowing, a heads-up before a long phase. If you need an answer, use " +
    "checkpoint.request instead. Notifications are rate-limited per run; prefer one good " +
    "message at a phase boundary over five progress updates.",
  scopes: ["run:notify"],
  sideEffect: "write",
  input: z.object({
    level: z.enum(["info", "success", "warning"]).default("info"),
    title: z.string().min(1).max(120),
    body: z.string().min(1).max(2000),
    channels: z.array(z.enum(["in-app", "email"])).default(["in-app"]),
  }),
  output: z.object({ delivered: z.array(z.string()), suppressed: z.boolean() }),
  idempotent: false,
  timeoutMs: 15_000,
  async execute() {
    throw new Error("notify.customer must be bound by the runtime before use.");
  },
  async simulate(input) {
    return { delivered: input.channels, suppressed: false };
  },
});

export const handoverPrepare = defineTool({
  id: "handover.prepare",
  version: "1.0.0",
  title: "Prepare a handover packet",
  description:
    "Assembles the packet that moves every provisioned asset to the customer: store ownership, " +
    "domain, payment account, DNS, brand source files, and a signed data export. Produces the " +
    "manifest and the per-provider steps; it does not execute the transfers, which happen " +
    "through each connector's handover path with verification before anything is marked done. " +
    "Available at any time and never gated behind a retention conversation.",
  scopes: ["run:artifacts"],
  sideEffect: "write",
  input: z.object({
    reason: z.enum(["customer-requested", "plan-change", "scheduled-escrow", "platform-wind-down"]),
    includeExports: z.array(z.string()).default(["orders", "customers", "products", "content", "brand-assets"]),
  }),
  output: z.object({ packetId: z.string(), itemCount: z.number().int(), targetCompletionAt: z.string() }),
  idempotent: true,
  timeoutMs: 60_000,
  async execute() {
    throw new Error("handover.prepare must be bound by the runtime before use.");
  },
  async simulate(input, ctx) {
    const rng = seedFor(ctx, "handover.prepare", input.reason);
    return {
      packetId: fakeId(rng, "hop"),
      itemCount: rng.int(4, 9),
      targetCompletionAt: isoFor(ctx, `handover.prepare:${input.reason}`, 5),
    };
  },
});

export const internalTools: readonly AnyTool[] = [
  artifactWrite,
  artifactRead,
  memoAppend,
  checkpointRequest,
  taskSpawn,
  notifyCustomer,
  handoverPrepare,
];

export const INTERNAL_TOOL_IDS: readonly string[] = internalTools.map((t) => t.id);
export { isoNow };
