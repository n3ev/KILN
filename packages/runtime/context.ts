import type { ArtifactType, RunMemo, VentureBrief } from "@kiln/contracts";
import { ContextOverflow } from "@kiln/contracts";
import { logger } from "@kiln/observability";
import type { AgentContext, AnyAgent } from "@kiln/agents";

/**
 * Context assembly — CLAUDE.md §8.5.
 *
 * Agents never receive the whole run. They get the brief, the specific upstream
 * artifacts their phase declared as dependencies, the rolling memo, and the
 * voice charter once it exists.
 *
 * The discipline matters for quality, not just cost: an agent given everything
 * attends to the wrong things, and the last item in a long context gets the
 * least attention. Truncation is logged rather than silent, because an agent
 * that quietly lost its dependency produces confidently wrong output.
 */

export const MEMO_TOKEN_CAP = 2_000;

/** ~4 characters per token. Good enough for budgeting; never for billing. */
export function approximateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function renderMemo(memo: RunMemo): string {
  if (memo.entries.length === 0) return "";
  const lines = memo.entries.map((e) => `- [${e.phase}] ${e.decision} — ${e.rationale}`);

  // Compact from the front: recent decisions constrain the current phase more
  // than the first one did, and the early ones are usually already reflected in
  // the artifacts this agent is being given anyway.
  let rendered = lines.join("\n");
  let dropped = 0;
  while (approximateTokens(rendered) > MEMO_TOKEN_CAP && lines.length > 1) {
    lines.shift();
    dropped++;
    rendered = lines.join("\n");
  }
  return dropped > 0 ? `(${dropped} earlier decisions compacted)\n${rendered}` : rendered;
}

export interface AssembleArgs {
  readonly agent: AnyAgent;
  readonly brief: VentureBrief;
  readonly memo: RunMemo;
  readonly dependsOn: readonly ArtifactType[];
  readonly artifacts: Readonly<Partial<Record<ArtifactType, unknown>>>;
  readonly archetype: "physical" | "digital" | "service";
  readonly runId: string;
  readonly seed: string;
  readonly critique?: string;
  readonly lintFeedback?: string;
}

export interface AssembledContext {
  readonly context: AgentContext;
  readonly approxTokens: number;
  readonly truncated: readonly ArtifactType[];
}

/**
 * Builds the scoped context for one invocation.
 *
 * Over-budget contexts drop the LARGEST optional artifact first and record it.
 * Dropping a declared dependency is refused outright — an agent that needs the
 * catalogue and does not get it will invent one, and inventing a catalogue is
 * far worse than failing loudly.
 */
export function assembleContext(args: AssembleArgs): AssembledContext {
  const voiceSource = args.artifacts["brand_system"] as
    | { voice?: { attributes: { attribute: string }[]; writes: string[]; neverWrites: string[]; emojiAllowed: boolean } }
    | undefined;

  const upstream: Partial<Record<ArtifactType, unknown>> = {};
  const truncated: ArtifactType[] = [];

  for (const type of args.dependsOn) {
    const artifact = args.artifacts[type];
    if (artifact === undefined) {
      logger.warn("declared dependency is missing from the artifact set", {
        agentId: args.agent.id,
        runId: args.runId,
        missing: type,
      });
      continue;
    }
    upstream[type] = artifact;
  }

  const memo = renderMemo(args.memo);

  const context: AgentContext = {
    brief: args.brief,
    memo,
    upstream,
    archetype: args.archetype,
    runId: args.runId,
    seed: args.seed,
    ...(voiceSource?.voice
      ? {
          voice: {
            attributes: voiceSource.voice.attributes.map((a) => a.attribute),
            writes: voiceSource.voice.writes,
            neverWrites: voiceSource.voice.neverWrites,
            emojiAllowed: voiceSource.voice.emojiAllowed,
          },
        }
      : {}),
    ...(args.critique ? { critique: args.critique } : {}),
    ...(args.lintFeedback ? { lintFeedback: args.lintFeedback } : {}),
  };

  const rendered = args.agent.systemPrompt(context) + JSON.stringify(upstream);
  const approxTokens = approximateTokens(rendered);

  if (approxTokens > args.agent.contextBudgetTokens) {
    logger.warn("context exceeds the agent's budget", {
      agentId: args.agent.id,
      runId: args.runId,
      approxTokens,
      budget: args.agent.contextBudgetTokens,
    });
    // Hard overflow is a real failure: the Repair agent decides whether to
    // degrade scope or escalate, rather than the assembler silently guessing.
    if (approxTokens > args.agent.contextBudgetTokens * 1.5) {
      throw new ContextOverflow(args.agent.id, approxTokens, args.agent.contextBudgetTokens);
    }
  }

  return { context, approxTokens, truncated };
}

/** Appends to the memo, keeping it inside its cap. */
export function appendMemo(memo: RunMemo, entry: RunMemo["entries"][number]): RunMemo {
  const entries = [...memo.entries, entry];
  return { entries, approxTokens: approximateTokens(renderMemo({ entries, approxTokens: 0 })) };
}
