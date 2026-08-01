import type { ArtifactType, RunEvent, RunMemo, RunState, VentureBrief } from "@kiln/contracts";
import type { ModelGateway } from "@kiln/model-gateway";
import type { GateInput } from "@kiln/quality";
import type { ToolContext } from "@kiln/tools";

export interface QualityEvidence {
  readonly probes?: NonNullable<GateInput["probes"]>;
  readonly negativeMarginAcknowledged?: boolean;
}

export interface OrchestratorDeps {
  readonly gateway: ModelGateway;
  /** Appends to the durable event log and returns its assigned sequence. */
  readonly emit: (event: RunEvent, actor: "agent" | "tool" | "human" | "system") => Promise<number>;
  readonly writeArtifact: (args: {
    type: ArtifactType;
    content: unknown;
    contentHash: string;
    quality: Record<string, unknown>;
    taskId: string;
  }) => Promise<string>;
  readonly callTool: (toolId: string, input: unknown, ctx: ToolContext) => Promise<unknown>;
  readonly toolContext: (agentId: string, taskId: string) => ToolContext;
  readonly requestCheckpoint: (args: {
    kind: string;
    title: string;
    question: string;
    context: string;
    /** Persists an autonomous veto window; the worker resumes after expiry. */
    vetoWindowMs?: number;
    options: { id: string; label: string; description: string; consequence: string; recommended: boolean }[];
  }) => Promise<{ optionId: string; approved: boolean }>;
  /** Persists restricted-category findings into the operator review queue. */
  readonly flagComplianceReview?: (findings: readonly {
    category: string;
    severity: "prohibited" | "restricted" | "age-gated" | "licence-required" | "permitted";
    jurisdictions: readonly string[];
    detail: string;
  }[]) => Promise<void>;
  /** External QA probes; artifact inputs always come from the run itself. */
  readonly qualityEvidence?: (
    run: RunContextState,
  ) => QualityEvidence | Promise<QualityEvidence>;
  /** Reloads state at phase boundaries so autonomy changes take effect there. */
  readonly refreshState?: () => RunState | Promise<RunState>;
  /** Clock seam keeps event-derived tests and quality reports reproducible. */
  readonly now?: () => string;
}

export interface RunContextState {
  readonly state: RunState;
  readonly brief: VentureBrief;
  readonly memo: RunMemo;
  readonly artifacts: Partial<Record<ArtifactType, unknown>>;
  readonly archetype: "physical" | "digital" | "service";
}
