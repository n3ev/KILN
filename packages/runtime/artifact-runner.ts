import type { AnyAgent } from "@kiln/agents";
import { requireAgent } from "@kiln/agents";
import {
  ARTIFACT_SCHEMAS,
  CriticRejected,
  CritiqueVerdict,
  SlopLintFailed,
  SupplyPlan,
  UnitEconomicsModel,
  ValidationReport,
  parseArtifactContent,
  type ArtifactType,
  type CritiqueVerdict as CritiqueVerdictValue,
} from "@kiln/contracts";
import type { ChatResult } from "@kiln/model-gateway";
import type { PhaseDef, Playbook } from "@kiln/playbooks";
import { formatForRewrite, rubricFor, slopLint } from "@kiln/quality";
import { contentHash } from "@kiln/tools";
import { assembleContext, appendMemo } from "./context.js";
import { memoWithAppliedHumanDirectives } from "./directives.js";
import { proseSegments } from "./prose.js";
import { evaluatePlaybookQuality } from "./quality-runner.js";
import { beginModelInvocation, finishModelInvocation } from "./model-tracking.js";
import type { OrchestratorDeps, RunContextState } from "./runtime-types.js";
import { emitTracked, runtimeNow, stableRuntimeId } from "./tracking.js";
import { runToolLoop } from "./tool-loop.js";

export const MAX_REPAIR_CYCLES = 3;

interface TaskResult {
  readonly run: RunContextState;
  readonly artifactId?: string;
}

function derivedArtifact(run: RunContextState, type: ArtifactType): unknown | undefined {
  if (type === "unit_economics") {
    const report = ValidationReport.safeParse(run.artifacts["validation_report"]);
    return report.success ? UnitEconomicsModel.parse(report.data.economics) : undefined;
  }
  if (type === "fulfilment_tradeoff") {
    const plan = SupplyPlan.safeParse(run.artifacts["supply_plan"]);
    return plan.success ? plan.data.tradeoff : undefined;
  }
  return undefined;
}

async function generateArtifact(
  deps: OrchestratorDeps,
  run: RunContextState,
  agent: AnyAgent,
  phase: PhaseDef,
  type: ArtifactType,
  taskId: string,
  critique: string | undefined,
  lintFeedback: string | undefined,
): Promise<{ run: RunContextState; output: unknown }> {
  const derived = derivedArtifact(run, type);
  if (derived !== undefined) return { run, output: derived };

  const assembled = assembleContext({
    agent,
    brief: run.brief,
    memo: memoWithAppliedHumanDirectives(run.memo, run.state.humanDirectives),
    dependsOn: phase.dependsOn,
    artifacts: run.artifacts,
    archetype: run.archetype,
    runId: run.state.runId,
    seed: run.state.seed,
    ...(critique ? { critique } : {}),
    ...(lintFeedback ? { lintFeedback } : {}),
  });
  const planned = await runToolLoop(deps, run, {
    agent,
    phase,
    taskId,
    systemPrompt: agent.systemPrompt(assembled.context),
    targetArtifact: type,
    upstream: assembled.context.upstream,
  });
  const messages = [
    ...planned.messages,
    {
      role: "user" as const,
      content: JSON.stringify({
        targetArtifact: type,
        instruction: `Return the complete ${type} artifact and no wrapper object. Use the gathered evidence above.`,
      }),
    },
  ];
  const invocation = await beginModelInvocation(
    deps,
    planned.run,
    { agentId: agent.id, taskId, selector: agent.model },
  );
  let streamingRun = invocation.run;
  let tokenBuffer = "";
  const generated = await deps.gateway.generateObjectDetailed({
    schema: ARTIFACT_SCHEMAS[type],
    schemaName: type,
    request: {
      messages,
      selector: agent.model,
      temperature: agent.temperature,
      context: {
        agentId: agent.id,
        taskKind: `${phase.key}:${type}`,
        seed: run.state.seed,
        runId: run.state.runId,
        taskId,
      },
    },
    onToken: async (text) => {
      tokenBuffer += text;
      if (tokenBuffer.length < 160) return;
      streamingRun = await emitTracked(
        deps,
        streamingRun,
        { type: "agent.token", taskId: taskId as never, text: tokenBuffer },
        "agent",
      );
      tokenBuffer = "";
    },
  });
  if (tokenBuffer.length > 0) {
    streamingRun = await emitTracked(
      deps,
      streamingRun,
      { type: "agent.token", taskId: taskId as never, text: tokenBuffer },
      "agent",
    );
  }
  streamingRun = await finishModelInvocation(
    deps,
    streamingRun,
    taskId,
    invocation.startedAt,
    generated.response,
  );
  return {
    run: streamingRun,
    output: generated.data,
  };
}

function lintArtifact(type: ArtifactType, output: unknown, cycle: number) {
  return proseSegments(type, output).map((part) => ({
    part,
    result: slopLint(part.text, { cycle }),
  }));
}

function lintBrief(failures: ReturnType<typeof lintArtifact>): string {
  return failures
    .filter(({ result }) => !result.passed)
    .map(({ part, result }) => `${part.label}\n${formatForRewrite(part.text, result)}`)
    .join("\n\n");
}

async function critiqueArtifact(
  deps: OrchestratorDeps,
  run: RunContextState,
  type: ArtifactType,
  artifact: unknown,
  taskId: string,
  cycle: number,
): Promise<{ run: RunContextState; verdict: CritiqueVerdictValue }> {
  const critic = requireAgent("critic");
  const rubric = rubricFor(type);
  if (!rubric) throw new Error(`No critic rubric exists for ${type}`);

  const invocation = await beginModelInvocation(
    deps,
    run,
    { agentId: critic.id, taskId, selector: critic.model },
  );
  const generated = await deps.gateway.generateObjectDetailed({
    schema: CritiqueVerdict,
    schemaName: "CritiqueVerdict",
    request: {
      messages: [
        {
          role: "system",
          content: critic.systemPrompt({
            brief: run.brief,
            memo: "",
            upstream: {},
            archetype: run.archetype,
            runId: run.state.runId,
            seed: run.state.seed,
          }),
        },
        { role: "user", content: JSON.stringify({ artifactType: type, rubric, cycle, artifact }) },
      ],
      selector: critic.model,
      temperature: critic.temperature,
      context: {
        agentId: critic.id,
        taskKind: `critique:${type}:${cycle}`,
        seed: run.state.seed,
        runId: run.state.runId,
        taskId,
      },
    },
  });
  return {
    run: await finishModelInvocation(
      deps,
      invocation.run,
      taskId,
      invocation.startedAt,
      generated.response,
    ),
    verdict: generated.data,
  };
}

function critiqueFeedback(verdict: CritiqueVerdictValue): string {
  return [
    verdict.summary,
    ...verdict.diffs.map((diff) =>
      `[${diff.axis}] ${diff.locate}: ${diff.problem} Fix: ${diff.instruction}`,
    ),
  ].join("\n");
}

export async function runArtifactTask(
  deps: OrchestratorDeps,
  initial: RunContextState,
  playbook: Playbook,
  phase: PhaseDef,
  phaseId: string,
  type: ArtifactType,
  attempt = 1,
): Promise<TaskResult> {
  const agent = requireAgent(phase.agent);
  const taskId = stableRuntimeId(initial.state.runId, "task", phase.key, type, String(attempt));
  let run = await emitTracked(
    deps,
    initial,
    {
      type: "task.started",
      taskId: taskId as never,
      phaseId: phaseId as never,
      agentId: agent.id,
      title: `${phase.title}: ${type}`,
      attempt,
    },
    "agent",
  );

  try {
    let critique: string | undefined;
    let lintFeedback: string | undefined;

    for (let cycle = 0; cycle <= MAX_REPAIR_CYCLES; cycle++) {
      const generated =
        type === "quality_report"
          ? { run, output: await evaluatePlaybookQuality(deps, run, playbook) }
          : await generateArtifact(deps, run, agent, phase, type, taskId, critique, lintFeedback);
      run = generated.run;
      const output = parseArtifactContent(type, generated.output);

      const linted = lintArtifact(type, output, cycle);
      const failingLint = linted.filter(({ result }) => !result.passed);
      if (failingLint.length > 0) {
        run = await emitTracked(
          deps,
          run,
          {
            type: "lint.blocked",
            taskId: taskId as never,
            ruleCount: failingLint.reduce((total, item) => total + item.result.findings.length, 0),
            cycle,
          },
          "system",
        );
        if (cycle >= MAX_REPAIR_CYCLES) {
          throw new SlopLintFailed(
            type,
            MAX_REPAIR_CYCLES,
            failingLint.flatMap(({ result }) =>
              result.findings.map((finding) => ({
                rule: finding.rule,
                excerpt: finding.excerpt,
                instruction: finding.rewriteInstruction,
              })),
            ),
          );
        }
        lintFeedback = lintBrief(failingLint);
        critique = undefined;
        continue;
      }

      const rubric = rubricFor(type);
      if (rubric) {
        const reviewed = await critiqueArtifact(deps, run, type, output, taskId, cycle);
        run = reviewed.run;
        const candidateId = stableRuntimeId(run.state.runId, "candidate", taskId, String(cycle));
        run = await emitTracked(
          deps,
          run,
          reviewed.verdict.passed
            ? { type: "critic.passed", artifactId: candidateId as never, cycle }
            : {
                type: "critic.rejected",
                artifactId: candidateId as never,
                cycle,
                summary: reviewed.verdict.summary,
              },
          "agent",
        );
        if (!reviewed.verdict.passed) {
          if (cycle >= MAX_REPAIR_CYCLES) throw new CriticRejected(type, cycle, reviewed.verdict);
          critique = critiqueFeedback(reviewed.verdict);
          lintFeedback = undefined;
          continue;
        }
      }

      const artifactId = await deps.writeArtifact({
        type,
        content: output,
        contentHash: contentHash(output),
        quality: {
          degraded: run.state.degraded,
          criticCycles: cycle,
          lintPassed: true,
        },
        taskId,
      });
      run = await emitTracked(
        deps,
        run,
        { type: "artifact.written", artifactId: artifactId as never, artifactType: type, version: 1 },
        "agent",
      );
      run = await emitTracked(
        deps,
        run,
        { type: "task.succeeded", taskId: taskId as never, artifactId: artifactId as never },
        "agent",
      );
      return {
        run: {
          ...run,
          artifacts: { ...run.artifacts, [type]: output },
          memo: appendMemo(run.memo, {
            phase: phase.key,
            decision: `Produced ${type}`,
            rationale: `${agent.title} completed after ${cycle} repair cycle(s).`,
            at: runtimeNow(deps),
          }),
        },
        artifactId,
      };
    }

    throw new CriticRejected(type, MAX_REPAIR_CYCLES, critique);
  } catch (error) {
    await deps.emit(
      {
        type: "task.failed",
        taskId: taskId as never,
        error: error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) },
      },
      "agent",
    );
    throw error;
  }
}
