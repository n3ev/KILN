import { randomUUID } from "node:crypto";
import type { RunEvent, RunEventRecord } from "@kiln/contracts";
import { InvariantViolated } from "@kiln/contracts";
import { describe, expect, it } from "vitest";
import { activePhase, fold, isBlocked, progress } from "../events.js";

/**
 * The fold is the load-bearing invariant of the whole runtime: if state is not
 * a pure function of the log, replay is meaningless and so is the audit trail.
 */

const runId = randomUUID();
const ventureId = randomUUID();
const seed = { runId, ventureId } as never;

let seq = 0;
const rec = (payload: RunEvent, createdAt = "2026-08-01T10:00:00.000Z"): RunEventRecord =>
  ({ id: randomUUID(), runId, seq: seq++, actor: "system", payload, createdAt }) as never;

const started = (): RunEventRecord =>
  rec({
    type: "run.started",
    playbookId: "physical-shopify",
    playbookVersion: "1.0.0",
    autonomy: "guided",
    seed: "abc",
    budgetMicros: 5_000_000,
  });

describe("fold", () => {
  it("starts from an empty state", () => {
    seq = 0;
    const state = fold(seed, []);
    expect(state.status).toBe("queued");
    expect(state.phases).toEqual([]);
    expect(state.lastSeq).toBe(0);
  });

  it("is pure — folding twice gives identical state", () => {
    seq = 0;
    const events = [started(), rec({ type: "phase.started", phaseId: randomUUID() as never, key: "intake", title: "Intake" })];
    expect(fold(seed, events)).toEqual(fold(seed, events));
  });

  it("tracks phase lifecycle", () => {
    seq = 0;
    const phaseId = randomUUID() as never;
    const state = fold(seed, [
      started(),
      rec({ type: "phase.started", phaseId, key: "intake", title: "Intake" }),
      rec({ type: "phase.succeeded", phaseId }),
    ]);
    expect(state.phases[0]?.status).toBe("succeeded");
    expect(state.phases[0]?.endedAt).toBeDefined();
    expect(activePhase(state)).toBeUndefined();
  });

  it("computes progress across phases", () => {
    seq = 0;
    const a = randomUUID() as never;
    const b = randomUUID() as never;
    const state = fold(seed, [
      started(),
      rec({ type: "phase.started", phaseId: a, key: "intake", title: "Intake" }),
      rec({ type: "phase.succeeded", phaseId: a }),
      rec({ type: "phase.started", phaseId: b, key: "validation", title: "Validation" }),
    ]);
    expect(progress(state)).toBe(50);
    expect(activePhase(state)?.key).toBe("validation");
  });

  it("blocks on a checkpoint and resumes only when all are decided", () => {
    seq = 0;
    const cp1 = randomUUID() as never;
    const cp2 = randomUUID() as never;

    const blocked = fold(seed, [
      started(),
      rec({ type: "checkpoint.requested", checkpointId: cp1, kind: "hard_gate", title: "Brand direction" }),
      rec({ type: "checkpoint.requested", checkpointId: cp2, kind: "spend_authorisation", title: "Domain" }),
    ]);
    expect(blocked.status).toBe("waiting_on_checkpoint");
    expect(isBlocked(blocked)).toBe(true);

    const partial = fold(seed, [
      started(),
      rec({ type: "checkpoint.requested", checkpointId: cp1, kind: "hard_gate", title: "Brand direction" }),
      rec({ type: "checkpoint.requested", checkpointId: cp2, kind: "spend_authorisation", title: "Domain" }),
      rec({ type: "checkpoint.decided", checkpointId: cp1, status: "approved" }),
    ]);
    // One decided, one outstanding: still blocked.
    expect(partial.status).toBe("waiting_on_checkpoint");

    const resumed = fold(seed, [
      started(),
      rec({ type: "checkpoint.requested", checkpointId: cp1, kind: "hard_gate", title: "Brand direction" }),
      rec({ type: "checkpoint.decided", checkpointId: cp1, status: "approved" }),
    ]);
    expect(resumed.status).toBe("running");
    expect(isBlocked(resumed)).toBe(false);
  });

  it("indexes artifacts by type, latest wins", () => {
    seq = 0;
    const first = randomUUID() as never;
    const second = randomUUID() as never;
    const state = fold(seed, [
      started(),
      rec({ type: "artifact.written", artifactId: first, artifactType: "strategy_memo", version: 1 }),
      rec({ type: "artifact.written", artifactId: second, artifactType: "strategy_memo", version: 2 }),
    ]);
    expect(state.artifactsByType["strategy_memo"]).toBe(second);
  });

  it("accumulates budget reservations and settles them", () => {
    seq = 0;
    const state = fold(seed, [
      started(),
      rec({ type: "budget.reserved", category: "model", micros: 50_000, ref: "r1" }),
      rec({ type: "budget.reserved", category: "model", micros: 30_000, ref: "r2" }),
      rec({ type: "budget.settled", category: "model", reservedMicros: 50_000, actualMicros: 42_000, ref: "r1" }),
    ]);
    const envelope = state.budgets.find((b) => b.category === "model");
    expect(envelope?.reservedMicros).toBe(30_000);
    expect(envelope?.spentMicros).toBe(42_000);
    expect(state.spentMicros).toBe(42_000);
  });

  it("marks the run degraded once a provider falls back, and it stays sticky", () => {
    seq = 0;
    const state = fold(seed, [
      started(),
      rec({ type: "provider.degraded", from: "kimi", to: "mock", reason: "HTTP 503" }),
      rec({ type: "notice", level: "info", message: "continuing" }),
    ]);
    expect(state.degraded).toBe(true);
  });

  it("folds a human directive from its durable queue into its applied state", () => {
    seq = 0;
    const directiveId = randomUUID() as never;
    const userId = randomUUID() as never;
    const state = fold(seed, [
      started(),
      rec({
        type: "human_directive",
        directiveId,
        directive: "Drop the third product from the launch catalogue.",
        byUserId: userId,
        applyAt: "next_phase",
        receivedPhaseKey: "offer",
      }, "2026-08-01T10:01:00.000Z"),
      rec({
        type: "human_directive.applied",
        directiveId,
        phaseKey: "infrastructure",
        appliedByAgentId: "planner",
      }, "2026-08-01T10:02:00.000Z"),
    ]);

    expect(state.humanDirectives).toEqual([expect.objectContaining({
      directiveId,
      status: "applied",
      appliedPhaseKey: "infrastructure",
      submittedAt: "2026-08-01T10:01:00.000Z",
      appliedAt: "2026-08-01T10:02:00.000Z",
    })]);
  });

  it("rejects an applied directive that was never submitted", () => {
    seq = 0;
    expect(() => fold(seed, [
      started(),
      rec({
        type: "human_directive.applied",
        directiveId: randomUUID() as never,
        phaseKey: "strategy",
        appliedByAgentId: "planner",
      }),
    ])).toThrow(InvariantViolated);
  });

  it("rejects an out-of-order log rather than silently sorting it", () => {
    const a = { id: randomUUID(), runId, seq: 5, actor: "system", payload: { type: "run.resumed" }, createdAt: "2026-08-01T10:00:00.000Z" } as never as RunEventRecord;
    const b = { id: randomUUID(), runId, seq: 2, actor: "system", payload: { type: "run.paused", reason: "x" }, createdAt: "2026-08-01T10:00:00.000Z" } as never as RunEventRecord;
    expect(() => fold(seed, [a, b])).toThrow(InvariantViolated);
  });

  it("rejects duplicated sequence numbers", () => {
    const dup = (): RunEventRecord =>
      ({ id: randomUUID(), runId, seq: 3, actor: "system", payload: { type: "run.resumed" }, createdAt: "2026-08-01T10:00:00.000Z" }) as never;
    expect(() => fold(seed, [dup(), dup()])).toThrow(InvariantViolated);
  });

  it("records the last sequence seen, so incremental folds can resume", () => {
    seq = 0;
    const events = [started(), rec({ type: "run.paused", reason: "waiting" })];
    expect(fold(seed, events).lastSeq).toBe(1);
  });

  it("reaches a terminal state and stays there", () => {
    seq = 0;
    const state = fold(seed, [started(), rec({ type: "run.succeeded" })]);
    expect(state.status).toBe("succeeded");
  });
});
