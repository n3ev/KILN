import type { LintResult, SlopFinding, VoiceCharter } from "@kiln/contracts";
import { ALL_RULES, DICTIONARY_VERSION, buildContext, type LintOptions, type Rule } from "./rules.js";

export { THRESHOLDS, ALL_RULES, DICTIONARY_VERSION } from "./rules.js";
export type { LintOptions, Rule, RuleContext } from "./rules.js";
export * from "./text.js";

/**
 * The slop linter — CLAUDE.md §3.1.
 *
 * Deterministic, non-AI, and **blocking**. Runs on every piece of
 * customer-facing copy before it can be written as an artifact. Blocked copy
 * goes back to the generating agent with the specific offending spans and a
 * rewrite instruction; after three failed repair cycles the run escalates to a
 * checkpoint rather than shipping prose nobody would pay for.
 *
 * The linter never rewrites. Nothing here is allowed to "fix" text, because a
 * linter that quietly patches its own findings is a linter you stop trusting.
 */

export const MAX_REPAIR_CYCLES = 3;

export interface SlopLintOptions extends LintOptions {
  /** Which repair cycle produced this text. Recorded on the result. */
  readonly cycle?: number;
  /** Rules to skip. Use sparingly, and never for `placeholder-residue`. */
  readonly disabledRules?: readonly string[];
}

/** Derives linter options from a brand's voice charter. */
export function optionsFromVoice(voice: VoiceCharter | undefined): LintOptions {
  if (!voice) return {};
  return {
    emojiAllowed: voice.emojiAllowed,
    extraBanned: voice.bannedWords,
  };
}

function sortFindings(findings: readonly SlopFinding[]): SlopFinding[] {
  // Blocking first, then by position, so the agent reads them in document order
  // and the first thing it sees is something it must actually fix.
  return [...findings].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "block" ? -1 : 1;
    return a.span.start - b.span.start;
  });
}

/** Overlapping rules can flag the same span twice; report it once. */
function dedupe(findings: readonly SlopFinding[]): SlopFinding[] {
  const seen = new Set<string>();
  const out: SlopFinding[] = [];
  for (const f of findings) {
    const key = `${f.rule}:${f.span.start}:${f.span.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

export function slopLint(text: string, options: SlopLintOptions = {}): LintResult {
  const ctx = buildContext(text, options);
  const disabled = new Set(options.disabledRules ?? []);
  const active: Rule[] = ALL_RULES.filter((r) => !disabled.has(r.id));

  const findings = dedupe(sortFindings(active.flatMap((rule) => rule.check(ctx))));
  const blocking = findings.filter((f) => f.severity === "block");

  return {
    passed: blocking.length === 0,
    findings,
    repairCycles: options.cycle ?? 0,
    wordCount: ctx.words,
    lintedAt: new Date().toISOString(),
  };
}

/**
 * Formats findings as the instruction block handed back to the generating
 * agent. Quotes the offending span rather than describing it, because
 * "your copy is generic" produces another generic draft.
 */
export function formatForRewrite(text: string, result: LintResult): string {
  const blocking = result.findings.filter((f) => f.severity === "block");
  if (blocking.length === 0) return "";

  const lines = blocking.map((f, i) => {
    const quoted = text.slice(f.span.start, f.span.end).replace(/\s+/g, " ").trim();
    return [
      `${i + 1}. [${f.rule}] ${f.message}`,
      `   Offending text: "${quoted}"`,
      `   Fix: ${f.rewriteInstruction}`,
    ].join("\n");
  });

  return [
    `Your draft failed ${blocking.length} blocking check${blocking.length === 1 ? "" : "s"} ` +
      `(dictionary v${DICTIONARY_VERSION}). Rewrite it.`,
    "",
    ...lines,
    "",
    "Rewrite the whole piece. Do not simply delete the flagged words — the",
    "phrasing around them is usually the real problem. Keep every factual claim",
    "and every source reference intact.",
  ].join("\n");
}

/** True once the linter has been given all the chances it gets. */
export function isRepairExhausted(result: LintResult): boolean {
  return !result.passed && result.repairCycles >= MAX_REPAIR_CYCLES;
}
