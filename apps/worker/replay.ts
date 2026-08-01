import { createHash } from "node:crypto";
import { requireAgent } from "@kiln/agents";
import {
  ArtifactType,
  QualityReport,
  RunMemo,
  type ArtifactType as ArtifactTypeValue,
  type Autonomy,
  type Scope,
  type VentureBrief,
} from "@kiln/contracts";
import { asServiceRole, getDb, rowsOf, type Database } from "@kiln/db";
import { ModelGateway } from "@kiln/model-gateway";
import { logger } from "@kiln/observability";
import { requirePlaybook } from "@kiln/playbooks";
import { fold, runPlaybook, type OrchestratorDeps, type RunContextState } from "@kiln/runtime";
import { buildRegistry, type ToolContext } from "@kiln/tools";
import { sql } from "drizzle-orm";
import { loadRunData } from "./run-data.js";
import { resolveRunGrants } from "./run-grants.js";
import { sandboxQualityEvidence } from "./run-adapter.js";

export type ArtifactHashes = Partial<Record<ArtifactTypeValue, string>>;

export interface ArtifactHashDiff {
  readonly type: ArtifactTypeValue;
  readonly status: "equal" | "changed" | "missing" | "added";
  readonly storedHash?: string;
  readonly replayHash?: string;
}

export interface SandboxReplayInput {
  readonly runId: string;
  readonly ventureId: string;
  readonly accountId: string;
  readonly playbookId: string;
  readonly playbookVersion: string;
  readonly archetype: "physical" | "digital" | "service";
  readonly autonomy: Autonomy;
  readonly seed: string;
  readonly brief: VentureBrief;
  readonly grantedScopes: readonly Scope[];
  readonly now: string;
}

export interface SandboxReplayOutput {
  readonly hashes: ArtifactHashes;
  readonly events: number;
  readonly status: "succeeded";
}

export interface RunReplayResult {
  readonly runId: string;
  readonly playbookId: string;
  readonly storedPlaybookVersion: string;
  readonly replayPlaybookVersion: string;
  readonly stored: ArtifactHashes;
  readonly replayed: ArtifactHashes;
  readonly diff: readonly ArtifactHashDiff[];
  readonly matched: boolean;
  readonly events: number;
  /**
   * True when this run's artifacts were written by `pnpm seed` rather than
   * produced by the orchestrator.
   *
   * The seeder synthesises each artifact directly from its schema, so its
   * hashes can never equal what a replay produces — the two derive their
   * randomness from different keys. Without this flag, `pnpm run:replay`
   * against the only data a fresh checkout has reports every artifact as
   * changed, which trains people to ignore the one tool that is supposed to
   * catch real regressions.
   */
  readonly seeded: boolean;
}

interface StoredArtifactRow {
  type: string;
  contentHash: string;
}

function stableId(runId: string, ...parts: readonly string[]): string {
  const hex = createHash("sha256").update([runId, ...parts].join("\0")).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}

function validHash(value: string, label: string): string {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error(`${label} is not a sha256 content hash`);
  return value.toLowerCase();
}

function replayClock(artifacts: Readonly<Partial<Record<ArtifactTypeValue, unknown>>>): string {
  const quality = QualityReport.safeParse(artifacts.quality_report);
  return quality.success ? quality.data.evaluatedAt : "2026-08-01T00:00:00.000Z";
}

export function compareArtifactHashes(stored: ArtifactHashes, replayed: ArtifactHashes): ArtifactHashDiff[] {
  const types = ArtifactType.options.filter((type) => stored[type] !== undefined || replayed[type] !== undefined);
  return types.map((type) => {
    const storedHash = stored[type];
    const replayHash = replayed[type];
    if (storedHash === undefined) return { type, status: "added", replayHash };
    if (replayHash === undefined) return { type, status: "missing", storedHash };
    return storedHash === replayHash
      ? { type, status: "equal", storedHash, replayHash }
      : { type, status: "changed", storedHash, replayHash };
  });
}

/** Re-executes a run without a database writer, credential lease, HTTP client, or live provider. */
export async function executeSandboxReplay(input: SandboxReplayInput): Promise<SandboxReplayOutput> {
  const playbook = requirePlaybook(input.playbookId);
  if (playbook.archetype !== input.archetype) {
    throw new Error(`Playbook ${playbook.id} cannot replay a ${input.archetype} venture`);
  }

  const registry = buildRegistry();
  const hashes: ArtifactHashes = {};
  let events = 0;
  const base = fold(
    { runId: input.runId as never, ventureId: input.ventureId as never },
    [],
  );
  const initial: RunContextState = {
    state: {
      ...base,
      autonomy: input.autonomy,
      seed: input.seed,
      playbookId: input.playbookId,
      playbookVersion: input.playbookVersion,
      grantedScopes: [...input.grantedScopes],
    },
    brief: input.brief,
    memo: RunMemo.parse({}),
    // This mirrors a genuinely fresh Postgres run: loadRunData supplies the
    // venture brief, but none of the source run's generated artifacts.
    artifacts: { venture_brief: input.brief },
    archetype: input.archetype,
  };
  const deps: OrchestratorDeps = {
    gateway: new ModelGateway({ order: ["mock"] }),
    emit: async () => ++events,
    writeArtifact: async (artifact) => {
      hashes[artifact.type] = validHash(artifact.contentHash, `Replay artifact ${artifact.type}`);
      return stableId(input.runId, "replay-artifact", artifact.type, artifact.contentHash);
    },
    requestCheckpoint: async (request) => {
      const selected = request.options.find((option) => option.recommended) ?? request.options[0];
      if (!selected) throw new Error(`Replay checkpoint ${request.title} has no options`);
      return {
        optionId: selected.id,
        approved: !/^(reject|revise|stop|veto)$/i.test(selected.id),
      };
    },
    qualityEvidence: () => sandboxQualityEvidence(),
    now: () => input.now,
    toolContext: (agentId, taskId): ToolContext => ({
      runId: input.runId,
      ventureId: input.ventureId,
      accountId: input.accountId,
      taskId,
      agentId,
      seed: `${input.seed}:${agentId}:${taskId}`,
      sandbox: true,
      grantedScopes: input.grantedScopes,
      lease: async () => ({
        id: stableId(input.runId, "replay-lease", agentId, taskId),
        provider: "replay-mock",
        expiresAt: "2099-01-01T00:00:00.000Z",
      }),
      http: {
        fetch: async () => {
          throw new Error("Replay network access is disabled; tools must use simulate()");
        },
      },
      logger: logger.child({ replayOf: input.runId, taskId, agentId }),
    }),
    callTool: async (toolId, rawInput, context) => {
      const agent = requireAgent(context.agentId);
      if (!agent.tools.includes(toolId)) throw new Error(`Agent ${agent.id} may not call ${toolId}`);
      const tool = registry.require(toolId);
      const missing = tool.scopes.filter((scope) => !context.grantedScopes.includes(scope));
      if (missing.length > 0) throw new Error(`Replay tool ${toolId} is missing scopes: ${missing.join(", ")}`);
      const parsed = tool.input.parse(rawInput) as never;
      // This is deliberately direct: replay has no execute() path at all.
      return tool.output.parse(await tool.simulate(parsed, context));
    },
  };

  const completed = await runPlaybook(deps, initial, playbook);
  if (completed.state.status !== "succeeded") {
    throw new Error(`Replay finished in unexpected state ${completed.state.status}`);
  }
  return { hashes, events, status: "succeeded" };
}

export async function replayExistingRun(
  runId: string,
  database?: Database,
): Promise<RunReplayResult> {
  const db = database ?? (await getDb());
  const loaded = await loadRunData(db, runId);
  const rows = await asServiceRole(db, async (tx) =>
    rowsOf<StoredArtifactRow>(await tx.execute(sql`
      SELECT DISTINCT ON (type) type, content_hash AS "contentHash"
      FROM artifacts
      WHERE run_id = ${runId}
      ORDER BY type, version DESC
    `)),
  );
  const stored: ArtifactHashes = {};
  for (const row of rows) {
    const type = ArtifactType.parse(row.type);
    stored[type] = validHash(row.contentHash, `Stored artifact ${type}`);
  }

  // `pnpm seed` stamps its runs with a `seed:` idempotency key. Reading it here
  // costs one cheap indexed lookup and is what lets the report distinguish
  // "the seeder authored these" from "your change broke determinism".
  const seeded = await asServiceRole(db, async (tx) =>
    rowsOf<{ idempotencyKey: string | null }>(
      await tx.execute(sql`SELECT idempotency_key AS "idempotencyKey" FROM runs WHERE id = ${runId}`),
    )[0]?.idempotencyKey?.startsWith("seed:") ?? false,
  );

  const playbook = requirePlaybook(loaded.row.playbookId);
  const grantedScopes = resolveRunGrants({
    accountId: loaded.row.accountId,
    entitlements: loaded.row.entitlements,
    playbookId: playbook.id,
    autonomy: loaded.row.autonomy,
    requiredScopes: playbook.requiredScopes,
  });
  const replayed = await executeSandboxReplay({
    runId,
    ventureId: loaded.row.ventureId,
    accountId: loaded.row.accountId,
    playbookId: loaded.row.playbookId,
    playbookVersion: loaded.row.playbookVersion,
    archetype: loaded.row.archetype,
    autonomy: loaded.row.autonomy,
    seed: loaded.row.seed,
    brief: loaded.brief,
    grantedScopes,
    now: replayClock(loaded.artifacts),
  });
  const diff = compareArtifactHashes(stored, replayed.hashes);
  return {
    runId,
    playbookId: playbook.id,
    storedPlaybookVersion: loaded.row.playbookVersion,
    replayPlaybookVersion: playbook.version,
    stored,
    replayed: replayed.hashes,
    diff,
    matched: diff.every((entry) => entry.status === "equal"),
    events: replayed.events,
    seeded,
  };
}

export function formatReplayReport(result: RunReplayResult): string {
  const verdict = result.matched ? "MATCH" : result.seeded ? "SEEDED RUN" : "MISMATCH";
  const lines = [
    `Replay ${verdict}: ${result.runId}`,
    `Playbook: ${result.playbookId} (stored ${result.storedPlaybookVersion}; replay ${result.replayPlaybookVersion})`,
    "Mode: isolated in-memory sandbox; mock model; simulated tools; network disabled",
  ];

  if (result.seeded && !result.matched) {
    lines.push(
      "",
      "This run came from `pnpm seed`, which writes artifacts straight from their",
      "schemas rather than running the orchestrator. Its hashes therefore cannot",
      "match a replay, and the differences below say nothing about your changes.",
      "To exercise this harness for real, replay a run the orchestrator produced,",
      "or run `pnpm test tests/evals/golden-runs.test.ts`, which asserts artifact",
      "determinism across all three playbooks.",
    );
  }
  lines.push("");
  for (const entry of result.diff) {
    const marker = { equal: "=", changed: "!", missing: "-", added: "+" }[entry.status];
    if (entry.status === "equal") {
      lines.push(`${marker} ${entry.type}  ${entry.storedHash}`);
    } else {
      lines.push(`${marker} ${entry.type}`);
      lines.push(`    stored  ${entry.storedHash ?? "(absent)"}`);
      lines.push(`    replay  ${entry.replayHash ?? "(absent)"}`);
    }
  }
  const changed = result.diff.filter((entry) => entry.status !== "equal").length;
  lines.push("", `Artifacts: ${result.diff.length - changed} equal, ${changed} different; replay events: ${result.events}`);
  return lines.join("\n");
}

/**
 * Exit 2 signals a genuine determinism regression, so CI can gate on it.
 * A seeded run is not a regression and must not turn a pipeline red.
 */
export function replayExitCode(result: Pick<RunReplayResult, "matched" | "seeded">): 0 | 2 {
  if (result.matched) return 0;
  return result.seeded ? 0 : 2;
}
