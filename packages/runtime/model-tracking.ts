import type { ChatResult, ModelSelector } from "@kiln/model-gateway";
import { emitTracked } from "./tracking.js";
import type { OrchestratorDeps, RunContextState } from "./runtime-types.js";

export interface InvocationStart {
  readonly run: RunContextState;
  readonly startedAt: number;
}

export async function beginModelInvocation(
  deps: OrchestratorDeps,
  run: RunContextState,
  input: { agentId: string; taskId: string; selector: ModelSelector },
): Promise<InvocationStart> {
  const selection = deps.gateway.primarySelection(input.selector);
  return {
    run: await emitTracked(
      deps,
      run,
      {
        type: "agent.invoked",
        taskId: input.taskId as never,
        agentId: input.agentId as never,
        model: selection.model,
        provider: selection.provider,
      },
      "agent",
    ),
    startedAt: performance.now(),
  };
}

export async function finishModelInvocation(
  deps: OrchestratorDeps,
  initial: RunContextState,
  taskId: string,
  startedAt: number,
  response: ChatResult,
): Promise<RunContextState> {
  let run = initial;
  if (response.degraded && !run.state.degraded) {
    run = await emitTracked(
      deps,
      run,
      {
        type: "provider.degraded",
        from: deps.gateway.primaryProviderId(),
        to: response.provider,
        reason: "model gateway used a configured fallback",
      },
      "system",
    );
  }
  return emitTracked(
    deps,
    run,
    {
      type: "agent.completed",
      taskId: taskId as never,
      promptTokens: response.usage.promptTokens,
      completionTokens: response.usage.completionTokens,
      costMicros: deps.gateway.resultCostMicros(response),
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    },
    "agent",
  );
}
