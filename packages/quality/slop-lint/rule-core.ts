import type { SlopFinding } from "@kiln/contracts";
import {
  countWords,
  excerptAround,
  splitBlocks,
  splitSentences,
  stripCode,
  type Block,
  type Sentence,
} from "./text.js";

/** Thresholds from CLAUDE.md §3.1, shared by rules and their tests. */
export const THRESHOLDS = {
  /** Consecutive sentences within this relative length of each other. */
  uniformSentenceRun: 3,
  uniformSentenceTolerance: 0.1,
  /** Words per single permitted occurrence. */
  emDashPerWords: 150,
  tricolonPerWords: 120,
  /** Participial paragraph openers permitted per document. */
  participialOpeners: 2,
  /** headings / body-blocks above this is listicle-brain. */
  headingToBodyRatio: 0.25,
  /** Below this many headings the ratio rule is not meaningful. */
  headingRatioMinHeadings: 3,
  /** Sentences shorter than this are ignored by the uniformity rule. */
  uniformitySentenceMinWords: 5,
} as const;

export interface LintOptions {
  /** Brand voice charter. Only an explicit opt-in permits emoji in body copy. */
  readonly emojiAllowed?: boolean;
  /** Extra brand-specific banned words from the voice charter. */
  readonly extraBanned?: readonly string[];
  /** Social posts are held to different structural rules than page copy. */
  readonly docType?: "body" | "email" | "social" | "product-description" | "headline";
}

export interface RuleContext {
  readonly text: string;
  readonly scrubbed: string;
  readonly sentences: Sentence[];
  readonly blocks: Block[];
  readonly words: number;
  readonly options: LintOptions;
}

export interface Rule {
  readonly id: string;
  readonly severity: "block" | "warn";
  check(ctx: RuleContext): SlopFinding[];
}

export function buildContext(text: string, options: LintOptions = {}): RuleContext {
  const scrubbed = stripCode(text);
  return {
    text,
    scrubbed,
    sentences: splitSentences(scrubbed),
    blocks: splitBlocks(text),
    words: countWords(scrubbed),
    options,
  };
}

export function finding(
  ctx: RuleContext,
  rule: string,
  severity: "block" | "warn",
  span: { start: number; end: number },
  message: string,
  rewriteInstruction: string,
): SlopFinding {
  return {
    rule,
    severity,
    message,
    span,
    excerpt: excerptAround(ctx.text, span),
    rewriteInstruction,
  };
}
