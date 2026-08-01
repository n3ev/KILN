import { requireAgent } from "@kiln/agents";
import { VentureBrief, type RunEvent } from "@kiln/contracts";
import { ModelGateway, synthesize, type ChatRequest, type ChatResult } from "@kiln/model-gateway";
import { physicalShopify } from "@kiln/playbooks";
import type { ToolContext } from "@kiln/tools";
import { describe, expect, it, vi } from "vitest";
import { apply, fold } from "../events.js";
import { runToolLoop } from "../tool-loop.js";
import type { OrchestratorDeps, RunContextState } from "../runtime-types.js";

const RUN_ID = "00000000-0000-4000-8000-000000000071";
const VENTURE_ID = "00000000-0000-4000-8000-000000000072";
const NOW = "2026-08-01T00:00:00.000Z";

class ToolRequestingGateway extends ModelGateway {
  calls = 0;

  override async complete(_request: ChatRequest): Promise<ChatResult> {
    this.calls++;
    return {
      text: this.calls === 1 ? "" : "READY",
      toolCalls: this.calls === 1
        ? [{ id: "call_search", name: "web.search", arguments: { query: "ceramic incense market", limit: 3 } }]
        : [],
      finishReason: this.calls === 1 ? "tool-calls" : "stop",
      usage: { promptTokens: 10, completionTokens: 2 },
      model: "mock:test",
      provider: "mock",
    };
  }
}

describe("bounded agent tool loop", () => {
  it("executes an allowed request and feeds the result back to the model", async () => {
    const gateway = new ToolRequestingGateway({ order: ["mock"] });
    const events: RunEvent[] = [];
    const callTool = vi.fn(async () => ({
      query: "ceramic incense market",
      results: [{ title: "Market", url: "https://example.test/market", snippet: "Demand evidence" }],
    }));
    const brief = synthesize(VentureBrief, "tool-loop-brief");
    const started = apply(
      fold({ runId: RUN_ID as never, ventureId: VENTURE_ID as never }, []),
      { type: "run.started", playbookId: "physical-shopify", playbookVersion: "1.0.0", autonomy: "guided", seed: "tool-loop", budgetMicros: 1_000_000 },
      NOW,
    );
    const run: RunContextState = {
      state: started,
      brief,
      memo: { entries: [], approxTokens: 0 },
      artifacts: {},
      archetype: "physical",
    };
    const context: ToolContext = {
      runId: RUN_ID,
      ventureId: VENTURE_ID,
      accountId: "00000000-0000-4000-8000-000000000073",
      agentId: "analyst",
      seed: "tool-loop",
      sandbox: true,
      grantedScopes: ["research:read"],
      lease: async () => { throw new Error("not needed"); },
      http: { fetch: async () => { throw new Error("not needed"); } },
      logger: { debug: () => undefined, info: () => undefined, warn: () => undefined },
    };
    const deps: OrchestratorDeps = {
      gateway,
      emit: async (event) => { events.push(event); return events.length; },
      writeArtifact: async () => "00000000-0000-4000-8000-000000000074",
      callTool,
      toolContext: () => context,
      requestCheckpoint: async () => ({ optionId: "approve", approved: true }),
      now: () => NOW,
    };
    const phase = physicalShopify.phases.find((candidate) => candidate.key === "validation");
    expect(phase).toBeDefined();

    const result = await runToolLoop(deps, run, {
      agent: requireAgent("analyst"),
      phase: phase!,
      taskId: "00000000-0000-4000-8000-000000000075",
      systemPrompt: "Gather evidence.",
      targetArtifact: "validation_report",
      upstream: {},
    });

    expect(gateway.calls).toBe(2);
    expect(callTool).toHaveBeenCalledWith("web.search", { query: "ceramic incense market", limit: 3 }, context);
    expect(events.map((event) => event.type)).toEqual([
      "agent.invoked",
      "agent.completed",
      "tool.called",
      "tool.succeeded",
      "agent.invoked",
      "agent.completed",
    ]);
    expect(result.messages.some((message) => message.role === "tool" && message.toolCallId === "call_search")).toBe(true);
  });
});
