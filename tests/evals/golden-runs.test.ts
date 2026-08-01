import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ArtifactType,
  QualityReport,
  VentureBrief,
  type RunEvent,
} from "../../packages/contracts/index.ts";
import { ModelGateway, synthesize } from "../../packages/model-gateway/index.ts";
import { PLAYBOOKS } from "../../packages/playbooks/index.ts";
import { buildRegistry, contentHash, type ToolContext } from "../../packages/tools/index.ts";
import { fold, runPlaybook, type OrchestratorDeps, type RunContextState } from "../../packages/runtime/index.ts";
import { slopLint } from "../../packages/quality/index.ts";
import { logger } from "../../packages/observability/index.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const Golden = z.object({
  playbookId: z.string(),
  archetype: z.enum(["physical", "digital", "service"]),
  seed: z.string(),
  oneLiner: z.string(),
  expectedArtifacts: z.array(ArtifactType),
  qualityGateCount: z.number().int(),
});

function evidence() {
  return {
    probes: {
      brokenLinks: [],
      deployedHtml: [
        { path: "/", html: "<main>Home</main>" },
        { path: "/offer", html: "<main>Offer</main>" },
        { path: "/policies", html: "<main>Policies</main>" },
      ],
      lighthouse: [
        { path: "/", performance: 96, accessibility: 99, seo: 99 },
        { path: "/offer", performance: 95, accessibility: 98, seo: 98 },
        { path: "/policies", performance: 97, accessibility: 100, seo: 99 },
      ],
      testTransaction: { completed: true, refunded: true, reference: "golden-test-order" },
      emailAuth: { spf: true, dkim: true, dmarc: true },
      analyticsPurchaseEvent: { fired: true, eventName: "purchase" },
    },
  };
}

/**
 * Context assembly warns rather than throws while an agent is only slightly
 * over budget, which is the right runtime behaviour and a useless signal in
 * CI — the mock's own prose pushed two agents over for a while and the warning
 * scrolled past on every run. Catching it here makes the golden runs the place
 * that notices.
 */
let contextWarnings: { agentId: unknown; approxTokens: unknown; budget: unknown }[] = [];

beforeEach(() => {
  contextWarnings = [];
  vi.spyOn(logger, "warn").mockImplementation((message, fields) => {
    if (message === "context exceeds the agent's budget") {
      contextWarnings.push({
        agentId: fields?.["agentId"],
        approxTokens: fields?.["approxTokens"],
        budget: fields?.["budget"],
      });
    }
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("golden sandbox runs", () => {
  for (const playbook of PLAYBOOKS) {
    it(`${playbook.id} remains complete, deterministic, and launch-clear`, async () => {
      const fixture = Golden.parse(JSON.parse(readFileSync(
        resolve(process.cwd(), `fixtures/runs/${playbook.id}.json`),
        "utf8",
      )));
      const runId = `10000000-0000-4000-8000-00000000000${PLAYBOOKS.indexOf(playbook) + 1}`;
      const ventureId = `20000000-0000-4000-8000-00000000000${PLAYBOOKS.indexOf(playbook) + 1}`;
      const accountId = `30000000-0000-4000-8000-00000000000${PLAYBOOKS.indexOf(playbook) + 1}`;
      const brief = VentureBrief.parse({
        ...synthesize(VentureBrief, `${fixture.seed}:brief`),
        oneLiner: fixture.oneLiner,
        archetypeHint: {
          archetype: fixture.archetype,
          confidence: 0.99,
          reasoning: "Golden fixture pins the intended playbook.",
        },
      });
      const initial: RunContextState = {
        state: {
          ...fold({ runId: runId as never, ventureId: ventureId as never }, []),
          autonomy: "guided",
          seed: fixture.seed,
          grantedScopes: [...playbook.requiredScopes],
        },
        brief,
        memo: { entries: [], approxTokens: 0 },
        artifacts: {},
        archetype: fixture.archetype,
      };
      const registry = buildRegistry();
      const events: RunEvent[] = [];
      const writes = new Map<string, unknown>();
      const toolContext = (agentId: string, taskId: string): ToolContext => ({
        runId,
        ventureId,
        accountId,
        taskId,
        agentId,
        seed: `${fixture.seed}:${agentId}:${taskId}`,
        sandbox: true,
        grantedScopes: playbook.requiredScopes,
        lease: async () => ({ id: "golden-lease", provider: "mock", expiresAt: "2026-08-02T00:00:00.000Z" }),
        http: { fetch: async () => { throw new Error("golden runs forbid network access"); } },
        logger: { debug() {}, info() {}, warn() {} },
      });
      const deps: OrchestratorDeps = {
        gateway: new ModelGateway({ order: ["mock"] }),
        emit: async (event) => { events.push(event); return events.length; },
        writeArtifact: async (artifact) => {
          writes.set(artifact.type, artifact.content);
          return `40000000-0000-4000-8000-${String(writes.size).padStart(12, "0")}`;
        },
        callTool: async (toolId, input, context) => {
          const tool = registry.require(toolId);
          return tool.output.parse(await tool.simulate(tool.input.parse(input) as never, context));
        },
        toolContext,
        requestCheckpoint: async () => ({ optionId: "approve", approved: true }),
        qualityEvidence: evidence,
        now: () => "2026-08-01T00:00:00.000Z",
      };

      let completed: Awaited<ReturnType<typeof runPlaybook>>;
      try {
        completed = await runPlaybook(deps, initial, playbook);
      } catch (error) {
        const report = QualityReport.safeParse(writes.get("quality_report"));
        if (report.success) {
          const catalogue = writes.get("product_catalogue") as {
            products?: { handle: string; description: string }[];
            services?: { handle: string; description: string }[];
            digitalDeliverables?: { handle: string; components: { description: string }[] }[];
          } | undefined;
          const descriptions = [
            ...(catalogue?.products ?? []).map((item) => ({ handle: item.handle, text: item.description })),
            ...(catalogue?.services ?? []).map((item) => ({ handle: item.handle, text: item.description })),
            ...(catalogue?.digitalDeliverables ?? []).map((item) => ({
              handle: item.handle,
              text: item.components.map((component) => component.description).join(" "),
            })),
          ];
          const failed = report.data.results
            .filter((result) => !result.passed && !result.overridden)
            .map((result) => ({
              gate: result.gate,
              assertions: result.assertions.filter((item) => !item.passed),
              descriptionLint: result.gate === "product-descriptions"
                ? descriptions.map(({ handle, text }) => ({ handle, findings: slopLint(text).findings }))
                : undefined,
            }));
          throw new Error(`Golden run ${playbook.id} failed quality: ${JSON.stringify(failed)}`, { cause: error });
        }
        throw error;
      }
      const artifactTypes = [...writes.keys()].sort();
      expect(completed.state.status).toBe("succeeded");
      expect(artifactTypes).toEqual([...fixture.expectedArtifacts].sort());
      const quality = QualityReport.parse(writes.get("quality_report"));
      expect(quality.clearedForLaunch).toBe(true);
      expect(quality.results).toHaveLength(fixture.qualityGateCount);
      expect(quality.results.every((result) => result.passed)).toBe(true);
      expect(events.some((event) => event.type === "agent.token")).toBe(true);
      expect(events.some((event) => event.type === "run.succeeded")).toBe(true);
      // Every agent stayed inside its declared context budget. The mock's own
      // filler is what this catches: it is upstream of every artifact, so when
      // it grows it grows every downstream agent's context at once.
      expect(contextWarnings).toEqual([]);
      expect(Object.fromEntries([...writes].map(([type, value]) => [type, contentHash(value)]))).toMatchSnapshot();
    });
  }
});
