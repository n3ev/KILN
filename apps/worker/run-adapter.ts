import { RunEvent, type Scope as ScopeValue } from "@kiln/contracts";
import { asServiceRole, getDb, type Database } from "@kiln/db";
import { ModelGateway } from "@kiln/model-gateway";
import { logger, type Logger } from "@kiln/observability";
import { requirePlaybook } from "@kiln/playbooks";
import {
  runPlaybook,
  type OrchestratorDeps,
  type QualityEvidence,
  type RunContextState,
} from "@kiln/runtime";
import type { ToolContext } from "@kiln/tools";
import { sql } from "drizzle-orm";
import type {
  ParsedRunExecutePayload,
  RunExecutionResult,
  RunExecutionService,
} from "./jobs.js";
import { loadRunData } from "./run-data.js";
import { resolveRunGrants } from "./run-grants.js";
import { CheckpointPendingError, PostgresRunStore } from "./run-store.js";
import { PostgresModelAccounting } from "./model-accounting.js";
import { PostgresToolPolicy } from "./tool-policy.js";

export { CheckpointPendingError } from "./run-store.js";

function errorRecord(error: unknown): Record<string, unknown> {
  return error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { name: "Error", message: String(error) };
}

/** Passing external probes used only for an explicitly sandboxed build. */
export function sandboxQualityEvidence(): QualityEvidence {
  return {
    probes: {
      brokenLinks: [],
      deployedHtml: [
        { path: "/", html: "<main><h1>Home</h1><p>Carefully made for a specific customer.</p></main>" },
        { path: "/offer", html: "<main><h1>Offer</h1><p>Materials, delivery and price are stated clearly.</p></main>" },
        { path: "/policies", html: "<main><h1>Policies</h1><p>Terms, privacy and refunds are linked here.</p></main>" },
      ],
      lighthouse: [
        { path: "/", performance: 96, accessibility: 100, seo: 100 },
        { path: "/offer", performance: 95, accessibility: 99, seo: 100 },
        { path: "/policies", performance: 98, accessibility: 100, seo: 98 },
      ],
      testTransaction: { completed: true, refunded: true, reference: "sandbox-test-order" },
      emailAuth: { spf: true, dkim: true, dmarc: true },
      analyticsPurchaseEvent: { fired: true, eventName: "purchase" },
    },
  };
}

export interface PostgresRunExecutorOptions {
  readonly database?: Database;
  readonly gateway?: ModelGateway;
  readonly now?: () => string;
  readonly signal?: AbortSignal;
  readonly log?: Logger;
}

/** Executes queued runs through the runtime while persisting its durable seams. */
export class PostgresRunExecutor implements RunExecutionService {
  readonly #database?: Database;
  readonly #gateway?: ModelGateway;
  readonly #now: () => string;
  readonly #signal?: AbortSignal;
  readonly #log: Logger;

  constructor(options: PostgresRunExecutorOptions = {}) {
    this.#database = options.database;
    this.#gateway = options.gateway;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#signal = options.signal;
    this.#log = options.log ?? logger;
  }

  async execute(payload: ParsedRunExecutePayload): Promise<RunExecutionResult> {
    const loaded = await loadRunData(this.#database, payload.runId);
    const playbook = requirePlaybook(loaded.row.playbookId);
    if (playbook.archetype !== loaded.row.archetype) {
      throw new Error(
        `Run ${payload.runId} uses ${playbook.id} (${playbook.archetype}) for a ${loaded.row.archetype} venture`,
      );
    }

    const store = new PostgresRunStore({
      runId: payload.runId,
      row: loaded.row,
      database: this.#database,
      now: this.#now,
      autoApproveSandboxCheckpoints: payload.autoApproveSandboxCheckpoints,
    });
    const state = await store.loadState();
    const context: RunContextState = {
      state,
      brief: loaded.brief,
      memo: loaded.memo,
      artifacts: loaded.artifacts,
      archetype: loaded.row.archetype,
    };
    if (state.status === "succeeded" || state.status === "cancelled") {
      return { runId: payload.runId, status: "already-terminal", artifacts: Object.keys(loaded.artifacts).length };
    }
    if (state.status === "paused") {
      return { runId: payload.runId, status: "paused", artifacts: Object.keys(loaded.artifacts).length };
    }

    const scopes = resolveRunGrants({
      accountId: loaded.row.accountId,
      entitlements: loaded.row.entitlements,
      playbookId: playbook.id,
      autonomy: loaded.row.autonomy,
      requiredScopes: playbook.requiredScopes,
    });
    const initial: RunContextState = { ...context, state: { ...state, grantedScopes: scopes } };
    const pending = await store.pendingCheckpointId();
    if (pending && (!loaded.row.sandbox || !payload.autoApproveSandboxCheckpoints)) {
      return { runId: payload.runId, status: "waiting-on-checkpoint", artifacts: Object.keys(loaded.artifacts).length };
    }

    const accounting = new PostgresModelAccounting({
      runId: payload.runId,
      budgetMicros: loaded.row.budgetMicros,
      database: this.#database,
    });
    const modelGateway = this.#gateway ?? new ModelGateway({ budget: accounting, costSink: accounting });
    const deps = this.#deps(payload.runId, loaded.row, scopes, store, modelGateway);
    try {
      const completed = await runPlaybook(deps, initial, playbook);
      return { runId: payload.runId, status: "succeeded", artifacts: Object.keys(completed.artifacts).length };
    } catch (error) {
      if (error instanceof CheckpointPendingError) {
        return { runId: payload.runId, status: "waiting-on-checkpoint", artifacts: Object.keys(loaded.artifacts).length };
      }
      try {
        await store.append(RunEvent.parse({ type: "run.failed", error: errorRecord(error) }), "system");
      } catch (persistError) {
        this.#log.error("failed to append run.failed after execution error", {
          runId: payload.runId,
          executionError: error instanceof Error ? error.message : String(error),
          persistenceError: persistError instanceof Error ? persistError.message : String(persistError),
        });
      }
      throw error;
    }
  }

  #deps(
    runId: string,
    row: Awaited<ReturnType<typeof loadRunData>>["row"],
    scopes: ScopeValue[],
    store: PostgresRunStore,
    modelGateway: ModelGateway,
  ): OrchestratorDeps {
    const toolPolicy = new PostgresToolPolicy({
      runId,
      budgetMicros: row.budgetMicros,
      autonomy: row.autonomy,
      store,
      database: this.#database,
    });
    return {
      gateway: modelGateway,
      emit: (event, actor) => store.append(event, actor),
      writeArtifact: (args) => store.writeArtifact(args),
      requestCheckpoint: (args) => store.requestCheckpoint(args),
      flagComplianceReview: async (findings) => {
        const database = this.#database ?? await getDb();
        await asServiceRole(database, async (tx) => {
          for (const finding of findings) {
            await tx.execute(sql`
              INSERT INTO abuse_reviews (account_id, venture_id, run_id, category, reason, evidence)
              VALUES (${row.accountId}, ${row.ventureId}, ${runId}, ${finding.category}, ${finding.detail},
                ${JSON.stringify({ severity: finding.severity, jurisdictions: finding.jurisdictions })}::jsonb)
              ON CONFLICT (run_id, category) DO UPDATE SET
                reason = EXCLUDED.reason, evidence = EXCLUDED.evidence
            `);
          }
        });
      },
      refreshState: async () => ({ ...(await store.loadState()), grantedScopes: scopes }),
      now: this.#now,
      qualityEvidence: row.sandbox ? () => sandboxQualityEvidence() : undefined,
      toolContext: (agentId, taskId): ToolContext => ({
        runId,
        ventureId: row.ventureId,
        accountId: row.accountId,
        taskId,
        agentId,
        seed: `${row.seed}:${agentId}:${taskId}`,
        sandbox: row.sandbox,
        grantedScopes: scopes,
        lease: async () => {
          throw new Error("Sandbox run tools never lease credentials; TODO(prompt-2) for live connector leases");
        },
        http: { fetch: async () => { throw new Error("Direct worker egress is disabled; TODO(prompt-2)"); } },
        logger: this.#log.child({ runId, taskId, agentId }),
        signal: this.#signal,
      }),
      callTool: (toolId, input, toolContext) => toolPolicy.invoke(toolId, input, toolContext),
    };
  }
}
