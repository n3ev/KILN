import {
  QualityGateFailed,
  QualityReport,
  SlopLintFailed,
  VentureBrief,
  type ArtifactType,
  type RunEvent,
} from "@kiln/contracts";
import {
  ModelGateway,
  synthesize,
  type GeneratedObject,
  type GenerateObjectOptions,
} from "@kiln/model-gateway";
import { physicalShopify } from "@kiln/playbooks";
import { buildRegistry, type ToolContext } from "@kiln/tools";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { fold } from "../events.js";
import {
  declaredArtifacts,
  runPhase,
  runPlaybook,
  type OrchestratorDeps,
  type QualityEvidence,
  type RunContextState,
} from "../orchestrator.js";

const RUN_ID = "00000000-0000-4000-8000-000000000001";
const VENTURE_ID = "00000000-0000-4000-8000-000000000002";
const NOW = "2026-08-01T00:00:00.000Z";

function passingEvidence(): QualityEvidence {
  return {
    probes: {
      brokenLinks: [],
      deployedHtml: [
        { path: "/", html: "<main>Home</main>" },
        { path: "/products/holder", html: "<main>Holder</main>" },
        { path: "/collections/all", html: "<main>Collection</main>" },
      ],
      lighthouse: [
        { path: "/", performance: 95, accessibility: 98, seo: 98 },
        { path: "/products/holder", performance: 94, accessibility: 97, seo: 99 },
        { path: "/collections/all", performance: 93, accessibility: 96, seo: 97 },
      ],
      testTransaction: { completed: true, refunded: true, reference: "txn_test" },
      emailAuth: { spf: true, dkim: true, dmarc: true },
      analyticsPurchaseEvent: { fired: true, eventName: "purchase" },
    },
  };
}

interface Harness {
  readonly deps: OrchestratorDeps;
  readonly initial: RunContextState;
  readonly events: RunEvent[];
  readonly writes: { type: ArtifactType; content: unknown }[];
  readonly checkpoints: string[];
}

class SloppyGateway extends ModelGateway {
  override async generateObjectDetailed<T extends z.ZodTypeAny>(
    options: GenerateObjectOptions<T>,
  ): Promise<GeneratedObject<z.infer<T>>> {
    const generated = await super.generateObjectDetailed(options);
    if (options.schemaName !== "strategy_memo") return generated;
    return {
      ...generated,
      data: options.schema.parse({
        ...(generated.data as Record<string, unknown>),
        positioningStatement: "Elevate your business with a world-class offer.",
      }) as z.infer<T>,
    };
  }
}

function harness(evidence: QualityEvidence, gateway: ModelGateway = new ModelGateway({ order: ["mock"] })): Harness {
  const events: RunEvent[] = [];
  const writes: { type: ArtifactType; content: unknown }[] = [];
  const checkpoints: string[] = [];
  const brief = synthesize(VentureBrief, "runtime-full-run-brief");
  const initial: RunContextState = {
    state: fold({ runId: RUN_ID as never, ventureId: VENTURE_ID as never }, []),
    brief,
    memo: { entries: [], approxTokens: 0 },
    artifacts: {},
    archetype: "physical",
  };
  const toolContext: ToolContext = {
    runId: RUN_ID,
    ventureId: VENTURE_ID,
    accountId: "00000000-0000-4000-8000-000000000003",
    agentId: "analyst",
    seed: "runtime-full-run",
    sandbox: true,
    grantedScopes: [],
    lease: async () => ({ id: "lease", provider: "mock", expiresAt: NOW }),
    http: { fetch: async () => { throw new Error("network is disabled in the runtime test"); } },
    logger: { debug: () => undefined, info: () => undefined, warn: () => undefined },
  };

  const registry = buildRegistry();
  const deps: OrchestratorDeps = {
    gateway,
    emit: async (event) => {
      events.push(event);
      return events.length;
    },
    writeArtifact: async (artifact) => {
      writes.push({ type: artifact.type, content: artifact.content });
      return `00000000-0000-4000-8000-${String(writes.length).padStart(12, "0")}`;
    },
    callTool: async (toolId, input, context) => {
      const tool = registry.require(toolId);
      const parsed = tool.input.parse(input) as never;
      return tool.output.parse(await tool.simulate(parsed, context));
    },
    toolContext: () => toolContext,
    requestCheckpoint: async (request) => {
      checkpoints.push(request.kind);
      return { optionId: "approve", approved: true };
    },
    qualityEvidence: () => evidence,
    now: () => NOW,
  };

  return { deps, initial, events, writes, checkpoints };
}

describe("playbook orchestration", () => {
  it("completes the physical playbook with mock and writes every declared artifact", async () => {
    const test = harness(passingEvidence());
    const completed = await runPlaybook(test.deps, test.initial, physicalShopify);

    expect(completed.state.status).toBe("succeeded");
    expect(completed.state.phases.every((phase) => phase.status === "succeeded")).toBe(true);
    expect(completed.state.lastSeq).toBe(test.events.length);
    expect(Object.keys(completed.artifacts).sort()).toEqual(declaredArtifacts(physicalShopify).sort());
    expect(test.writes.map((write) => write.type).sort()).toEqual(declaredArtifacts(physicalShopify).sort());

    const quality = QualityReport.parse(completed.artifacts["quality_report"]);
    expect(quality.clearedForLaunch).toBe(true);
    expect(quality.results).toHaveLength(physicalShopify.qualityGates.length);
    expect(test.events.some((event) => event.type === "quality.evaluated" && event.passed)).toBe(true);
    expect(test.events.at(-1)?.type).toBe("run.succeeded");
  });

  it("resumes after a completed phase without rerunning its model tasks", async () => {
    const test = harness(passingEvidence());
    const brief = VentureBrief.parse(test.initial.brief);
    const resumed: RunContextState = {
      ...test.initial,
      state: {
        ...test.initial.state,
        status: "running",
        playbookId: physicalShopify.id,
        playbookVersion: physicalShopify.version,
        seed: "resume-seed",
        phases: [{
          id: "10000000-0000-4000-8000-000000000001" as never,
          key: "intake",
          title: "Intake",
          status: "succeeded",
          orderIndex: 0,
          startedAt: NOW,
          endedAt: NOW,
        }],
        artifactsByType: {
          venture_brief: "10000000-0000-4000-8000-000000000002" as never,
        },
      },
      artifacts: { venture_brief: brief },
    };

    const completed = await runPlaybook(test.deps, resumed, physicalShopify);
    expect(completed.state.status).toBe("succeeded");
    expect(test.writes.some((write) => write.type === "venture_brief")).toBe(false);
    expect(test.events.some((event) => event.type === "phase.started" && event.key === "intake")).toBe(false);
  });

  it("hard-blocks prohibited businesses before writing a build artifact", async () => {
    const test = harness(passingEvidence());
    const malicious: RunContextState = {
      ...test.initial,
      brief: VentureBrief.parse({
        ...test.initial.brief,
        oneLiner: "Sell unlicensed firearms, ammunition, counterfeit goods, and THC products online.",
        slots: {
          ...test.initial.brief.slots,
          offer: {
            status: "answered",
            value: "Unlicensed firearms and counterfeit THC products",
            confidence: 1,
            sources: [{ kind: "customer", statement: "Customer supplied product description" }],
          },
        },
      }),
    };

    await expect(runPlaybook(test.deps, malicious, physicalShopify)).rejects.toMatchObject({
      code: "COMPLIANCE_BLOCKED",
    });
    expect(test.writes).toEqual([]);
    expect(test.events.some((event) => event.type === "run.succeeded")).toBe(false);
  });

  it("writes the failed quality report and blocks before launch", async () => {
    const evidence = passingEvidence();
    const test = harness({
      ...evidence,
      probes: { ...evidence.probes, brokenLinks: ["/missing-policy"] },
    });

    await expect(runPlaybook(test.deps, test.initial, physicalShopify)).rejects.toBeInstanceOf(QualityGateFailed);

    const reportWrite = test.writes.find((write) => write.type === "quality_report");
    const quality = QualityReport.parse(reportWrite?.content);
    expect(quality.clearedForLaunch).toBe(false);
    expect(quality.results.find((result) => result.gate === "no-broken-links")?.passed).toBe(false);
    expect(test.events.some((event) => event.type === "phase.started" && event.key === "launch")).toBe(false);
    expect(test.events.some((event) => event.type === "run.succeeded")).toBe(false);
    expect(test.checkpoints).toContain("repair_escalation");
  });

  it("blocks and escalates instead of writing copy after lint repair exhaustion", async () => {
    const test = harness(passingEvidence(), new SloppyGateway({ order: ["mock"] }));
    const strategy = physicalShopify.phases.find((phase) => phase.key === "strategy");
    expect(strategy).toBeDefined();

    await expect(runPhase(test.deps, test.initial, physicalShopify, strategy!)).rejects.toBeInstanceOf(
      SlopLintFailed,
    );

    expect(test.writes.some((write) => write.type === "strategy_memo")).toBe(false);
    expect(test.events.filter((event) => event.type === "lint.blocked").map((event) => event.cycle)).toEqual([
      0, 1, 2, 3,
    ]);
    expect(test.checkpoints).toContain("repair_escalation");
  });
});
