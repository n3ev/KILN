import { VentureBrief } from "@kiln/contracts";
import { synthesize } from "@kiln/model-gateway";
import { physicalShopify } from "@kiln/playbooks";
import { declaredArtifacts } from "@kiln/runtime";
import { describe, expect, it } from "vitest";
import {
  compareArtifactHashes,
  executeSandboxReplay,
  formatReplayReport,
  replayExitCode,
  type SandboxReplayInput,
} from "../replay.js";

const replayInput: SandboxReplayInput = {
  runId: "11111111-1111-4111-8111-111111111111",
  ventureId: "22222222-2222-4222-8222-222222222222",
  accountId: "33333333-3333-4333-8333-333333333333",
  playbookId: physicalShopify.id,
  playbookVersion: physicalShopify.version,
  archetype: physicalShopify.archetype,
  autonomy: "guided",
  seed: "worker-replay-test",
  brief: synthesize(VentureBrief, "worker-replay-brief"),
  grantedScopes: physicalShopify.requiredScopes,
  now: "2026-08-01T00:00:00.000Z",
};

describe("artifact replay diff", () => {
  it("reports changed, missing and newly added artifact hashes", () => {
    const a = "a".repeat(64);
    const b = "b".repeat(64);
    const c = "c".repeat(64);
    const diff = compareArtifactHashes(
      { venture_brief: a, strategy_memo: a, brand_system: b },
      { venture_brief: a, strategy_memo: c, quality_report: c },
    );

    expect(diff).toEqual([
      { type: "venture_brief", status: "equal", storedHash: a, replayHash: a },
      { type: "strategy_memo", status: "changed", storedHash: a, replayHash: c },
      { type: "brand_system", status: "missing", storedHash: b },
      { type: "quality_report", status: "added", replayHash: c },
    ]);
    const report = formatReplayReport({
      runId: replayInput.runId,
      playbookId: replayInput.playbookId,
      storedPlaybookVersion: "1.0.0",
      replayPlaybookVersion: "1.1.0",
      stored: {},
      replayed: {},
      diff,
      matched: false,
      events: 42,
      seeded: false,
    });
    expect(report).toContain("Replay MISMATCH");
    expect(report).toContain(`stored  ${b}`);
    expect(report).toContain("Artifacts: 1 equal, 3 different");
    expect(replayExitCode({ matched: false, seeded: false })).toBe(2);
    expect(replayExitCode({ matched: true, seeded: false })).toBe(0);
  });

  /**
   * A seeded run can never match a replay: `pnpm seed` synthesises artifacts
   * from their schemas instead of running the orchestrator. Reporting that as a
   * mismatch teaches people to ignore the harness, so it has to read differently
   * and must not fail CI.
   */
  it("explains a seeded run rather than calling it a regression", () => {
    const a = "a".repeat(64);
    const b = "b".repeat(64);
    const report = formatReplayReport({
      runId: replayInput.runId,
      playbookId: replayInput.playbookId,
      storedPlaybookVersion: "1.0.0",
      replayPlaybookVersion: "1.0.0",
      stored: { strategy_memo: a },
      replayed: { strategy_memo: b },
      diff: compareArtifactHashes({ strategy_memo: a }, { strategy_memo: b }),
      matched: false,
      events: 12,
      seeded: true,
    });

    expect(report).toContain("Replay SEEDED RUN");
    expect(report).not.toContain("Replay MISMATCH");
    expect(report).toContain("pnpm seed");
    expect(report).toContain("golden-runs.test.ts");
    expect(replayExitCode({ matched: false, seeded: true })).toBe(0);
  });

  it("still fails a genuine mismatch on a non-seeded run", () => {
    expect(replayExitCode({ matched: false, seeded: false })).toBe(2);
  });

  it("re-executes a full playbook deterministically in the isolated sandbox", async () => {
    const first = await executeSandboxReplay(replayInput);
    const second = await executeSandboxReplay(replayInput);

    expect(first.status).toBe("succeeded");
    expect(first.hashes).toEqual(second.hashes);
    expect(Object.keys(first.hashes)).toHaveLength(declaredArtifacts(physicalShopify).length);
    expect(first.events).toBeGreaterThan(0);
  });
});
