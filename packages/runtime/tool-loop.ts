import type { AnyAgent } from "@kiln/agents";
import type { ChatMessage } from "@kiln/model-gateway";
import type { PhaseDef } from "@kiln/playbooks";
import { buildRegistry } from "@kiln/tools";
import { beginModelInvocation, finishModelInvocation } from "./model-tracking.js";
import type { OrchestratorDeps, RunContextState } from "./runtime-types.js";
import { emitTracked, stableRuntimeId } from "./tracking.js";

function errorRecord(error: unknown): Record<string, unknown> {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "Error", message: String(error) };
}

interface UntrustedSignal {
  readonly present: boolean;
  readonly adversarialCount: number;
}

/** Finds quarantined output without trusting a provider-specific response shape. */
function scanUntrusted(value: unknown, depth = 0): UntrustedSignal {
  if (depth > 8) return { present: false, adversarialCount: 0 };
  if (typeof value === "string") {
    return { present: value.includes("<untrusted-content"), adversarialCount: 0 };
  }
  if (value === null || typeof value !== "object") return { present: false, adversarialCount: 0 };

  const record = value as Record<string, unknown>;
  const neutralised = Array.isArray(record["neutralised"]) ? record["neutralised"] : [];
  const directCount = neutralised.reduce((total, finding) => {
    if (finding === null || typeof finding !== "object") return total;
    const count = (finding as Record<string, unknown>)["count"];
    return total + (typeof count === "number" && Number.isFinite(count) ? count : 0);
  }, 0);
  return Object.values(record).reduce<UntrustedSignal>(
    (found, nested) => {
      const next = scanUntrusted(nested, depth + 1);
      return {
        present: found.present || next.present,
        adversarialCount: found.adversarialCount + next.adversarialCount,
      };
    },
    { present: directCount > 0, adversarialCount: directCount },
  );
}

export interface ToolLoopInput {
  readonly agent: AnyAgent;
  readonly phase: PhaseDef;
  readonly taskId: string;
  readonly systemPrompt: string;
  readonly targetArtifact: string;
  readonly upstream: unknown;
}

/**
 * Gives an agent bounded opportunities to gather evidence before its final
 * typed answer. Every requested tool still crosses the runtime dependency,
 * where allowlists, scopes, budget, audit, and sandbox routing are enforced.
 */
export async function runToolLoop(
  deps: OrchestratorDeps,
  initial: RunContextState,
  input: ToolLoopInput,
): Promise<{ run: RunContextState; messages: ChatMessage[] }> {
  const messages: ChatMessage[] = [
    { role: "system", content: input.systemPrompt },
    {
      role: "user",
      content: JSON.stringify({
        targetArtifact: input.targetArtifact,
        upstream: input.upstream,
        instruction: "Gather only the evidence you need. Request an allowed tool, or reply READY when no tool is needed.",
      }),
    },
  ];
  if (input.agent.tools.length === 0 || input.agent.maxSteps <= 1) return { run: initial, messages };

  const registry = buildRegistry();
  const toolSchemas = registry.toModelSchemas(input.agent.tools);
  let run = initial;
  let untrustedFromPriorStep = false;

  // Reserve the final declared step for the schema-constrained artifact call.
  for (let step = 1; step < input.agent.maxSteps; step++) {
    const confirmationWindow = untrustedFromPriorStep;
    untrustedFromPriorStep = false;
    let untrustedInThisStep = false;
    const invocation = await beginModelInvocation(
      deps,
      run,
      { agentId: input.agent.id, taskId: input.taskId, selector: input.agent.model },
    );
    run = invocation.run;
    const response = await deps.gateway.complete({
      messages,
      tools: toolSchemas,
      selector: input.agent.model,
      temperature: input.agent.temperature,
      context: {
        agentId: input.agent.id,
        taskKind: `${input.phase.key}:${input.targetArtifact}:tool-plan:${step}`,
        seed: run.state.seed,
        runId: run.state.runId,
        taskId: input.taskId,
      },
    });
    run = await finishModelInvocation(deps, run, input.taskId, invocation.startedAt, response);
    messages.push({ role: "assistant", content: response.text, toolCalls: response.toolCalls });
    if (response.toolCalls.length === 0) break;

    for (const [index, call] of response.toolCalls.entries()) {
      const toolCallId = call.id || stableRuntimeId(run.state.runId, "tool", input.taskId, String(step), String(index));
      if (!input.agent.tools.includes(call.name)) {
        const error = new Error(`Agent ${input.agent.id} is not allowed to call ${call.name}`);
        run = await emitTracked(deps, run, { type: "tool.failed", toolCallId, error: errorRecord(error) }, "tool");
        messages.push({ role: "tool", name: call.name, toolCallId, content: JSON.stringify({ error: error.message }) });
        continue;
      }
      const baseContext = deps.toolContext(input.agent.id, input.taskId);
      run = await emitTracked(
        deps,
        run,
        {
          type: "tool.called",
          taskId: input.taskId as never,
          toolCallId,
          toolId: call.name,
          sandboxed: baseContext.sandbox,
          input: call.arguments,
        },
        "agent",
      );
      const startedAt = performance.now();
      try {
        const output = await deps.callTool(
          call.name,
          call.arguments,
          {
            ...baseContext,
            ...((confirmationWindow || untrustedInThisStep)
              ? { untrustedContentIngested: true }
              : {}),
          },
        );
        const signal = scanUntrusted(output);
        if (signal.present) untrustedInThisStep = true;
        if (signal.adversarialCount > 0) {
          run = await emitTracked(
            deps,
            run,
            {
              type: "notice",
              level: "warn",
              message: `Detected and neutralised ${signal.adversarialCount} instruction-like pattern(s) in untrusted web content.`,
            },
            "system",
          );
          baseContext.logger.warn("prompt-injection pattern neutralised", {
            toolId: call.name,
            count: signal.adversarialCount,
          });
        }
        run = await emitTracked(
          deps,
          run,
          { type: "tool.succeeded", toolCallId, latencyMs: Math.max(0, Math.round(performance.now() - startedAt)), costMicros: 0 },
          "tool",
        );
        messages.push({ role: "tool", name: call.name, toolCallId, content: JSON.stringify(output) });
      } catch (error) {
        run = await emitTracked(deps, run, { type: "tool.failed", toolCallId, error: errorRecord(error) }, "tool");
        messages.push({
          role: "tool",
          name: call.name,
          toolCallId,
          content: JSON.stringify({ error: error instanceof Error ? error.message : String(error), correctable: true }),
        });
      }
    }
    untrustedFromPriorStep = untrustedInThisStep;
  }
  return { run, messages };
}
