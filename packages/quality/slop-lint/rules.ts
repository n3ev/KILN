import type { SlopFinding } from "@kiln/contracts";
import bannedDictionary from "../dictionaries/banned.json" with { type: "json" };
import fixtureFillerDictionary from "../dictionaries/fixture-filler.json" with { type: "json" };
import { finding, THRESHOLDS, type Rule } from "./rule-core.js";
import { splitSentences } from "./text.js";

export { buildContext, THRESHOLDS } from "./rule-core.js";
export type { LintOptions, Rule, RuleContext } from "./rule-core.js";

/**
 * The rules.
 *
 * Every one is deterministic — no model is consulted. That is the point: a
 * quality bar enforced by a model is a quality bar that argues with you, and
 * the whole reason this exists is that the model's own judgement of its prose
 * is exactly what cannot be trusted.
 *
 * Thresholds come from CLAUDE.md §3.1 and are exported so tests assert against
 * the same constants the rules use.
 */

// ── 1. Banned phrases ────────────────────────────────────────────────────────

interface DictEntry {
  phrase?: string;
  pattern?: string;
  id?: string;
  why: string;
  instead: string;
}

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface CompiledEntry {
  id: string;
  regex: RegExp;
  why: string;
  instead: string;
}

function compileDictionary(entries: readonly DictEntry[]): CompiledEntry[] {
  return entries.map((e) => {
    if (e.pattern !== undefined) {
      return { id: e.id ?? e.pattern, regex: new RegExp(e.pattern, "gi"), why: e.why, instead: e.instead };
    }
    const phrase = e.phrase ?? "";
    // Word boundaries on both sides so "journeyman" does not trip "journey".
    return {
      id: phrase,
      regex: new RegExp(`\\b${escapeRegex(phrase).replace(/\\?\s+/g, "\\s+")}\\b`, "gi"),
      why: e.why,
      instead: e.instead,
    };
  });
}

const DICTIONARY: CompiledEntry[] = compileDictionary(bannedDictionary.entries as DictEntry[]);
export const DICTIONARY_VERSION: string = bannedDictionary.version;

export const bannedPhraseRule: Rule = {
  id: "banned-phrase",
  severity: "block",
  check(ctx) {
    const findings: SlopFinding[] = [];
    const extra = compileDictionary(
      (ctx.options.extraBanned ?? []).map((phrase) => ({
        phrase,
        why: "Listed in this brand's voice charter as a word it never uses.",
        instead: "Rewrite in the brand's own vocabulary.",
      })),
    );

    for (const entry of [...DICTIONARY, ...extra]) {
      entry.regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = entry.regex.exec(ctx.scrubbed)) !== null) {
        findings.push(
          finding(
            ctx,
            "banned-phrase",
            "block",
            { start: match.index, end: match.index + match[0].length },
            `"${match[0].trim()}" — ${entry.why}`,
            entry.instead,
          ),
        );
        if (match[0].length === 0) entry.regex.lastIndex++;
      }
    }
    return findings;
  },
};

// ── 2. Sentence-length uniformity ────────────────────────────────────────────

export const sentenceUniformityRule: Rule = {
  id: "sentence-length-uniformity",
  severity: "block",
  check(ctx) {
    const considered = ctx.sentences.filter((s) => s.wordCount >= THRESHOLDS.uniformitySentenceMinWords);
    const findings: SlopFinding[] = [];

    for (let i = 0; i + THRESHOLDS.uniformSentenceRun <= considered.length; i++) {
      const window = considered.slice(i, i + THRESHOLDS.uniformSentenceRun);
      const lengths = window.map((s) => s.wordCount);
      const min = Math.min(...lengths);
      const max = Math.max(...lengths);
      if (min === 0) continue;
      if ((max - min) / min > THRESHOLDS.uniformSentenceTolerance) continue;

      const first = window[0];
      const last = window[window.length - 1];
      if (!first || !last) continue;

      findings.push(
        finding(
          ctx,
          "sentence-length-uniformity",
          "block",
          { start: first.start, end: last.end },
          `${window.length} consecutive sentences of ${lengths.join(", ")} words — near-identical length reads as machine cadence.`,
          "Vary the rhythm. Cut one sentence to under six words, or merge two into a longer one.",
        ),
      );
      i += THRESHOLDS.uniformSentenceRun - 1; // one finding per run, not per window
    }
    return findings;
  },
};

// ── 3. Em-dash density ───────────────────────────────────────────────────────

export const emDashRule: Rule = {
  id: "em-dash-density",
  severity: "block",
  check(ctx) {
    const allowed = Math.max(1, Math.floor(ctx.words / THRESHOLDS.emDashPerWords));
    const matches = [...ctx.scrubbed.matchAll(/—|\s--\s/g)];
    if (matches.length <= allowed) return [];

    return matches.slice(allowed).map((m) =>
      finding(
        ctx,
        "em-dash-density",
        "block",
        { start: m.index ?? 0, end: (m.index ?? 0) + m[0].length },
        `${matches.length} em-dashes in ${ctx.words} words; ${allowed} permitted at 1 per ${THRESHOLDS.emDashPerWords}.`,
        "Replace with a full stop, a comma, or a colon. Keep at most one em-dash per 150 words.",
      ),
    );
  },
};

// ── 4. Tricolon density ──────────────────────────────────────────────────────

const TRICOLON =
  /\b[\p{L}\p{N}'’-]+(?:\s+[\p{L}\p{N}'’-]+){0,3},\s+[\p{L}\p{N}'’-]+(?:\s+[\p{L}\p{N}'’-]+){0,3},\s+(?:and|or)\s+[\p{L}\p{N}'’-]+/giu;

export const tricolonRule: Rule = {
  id: "tricolon-density",
  severity: "block",
  check(ctx) {
    const allowed = Math.max(1, Math.floor(ctx.words / THRESHOLDS.tricolonPerWords));
    const matches = [...ctx.scrubbed.matchAll(TRICOLON)];
    if (matches.length <= allowed) return [];

    return matches.slice(allowed).map((m) =>
      finding(
        ctx,
        "tricolon-density",
        "block",
        { start: m.index ?? 0, end: (m.index ?? 0) + m[0].length },
        `${matches.length} "X, Y, and Z" triples in ${ctx.words} words; ${allowed} permitted.`,
        "Break the list. Name one item and cut the other two, or give each its own sentence.",
      ),
    );
  },
};

// ── 5. Participial paragraph openers ─────────────────────────────────────────

const PARTICIPIAL_OPENER = /^(?:\p{Lu}[\p{L}'’-]*(?:ing|ed))\b[^.!?]{0,120},/u;

export const participialOpenerRule: Rule = {
  id: "participial-opener",
  severity: "block",
  check(ctx) {
    const offenders = ctx.blocks
      .filter((b) => b.kind === "paragraph" && PARTICIPIAL_OPENER.test(b.text))
      .slice(THRESHOLDS.participialOpeners);

    return offenders.map((b) =>
      finding(
        ctx,
        "participial-opener",
        "block",
        { start: b.start, end: Math.min(b.end, b.start + 60) },
        `Paragraph opens with a participial phrase more than ${THRESHOLDS.participialOpeners} times in this document.`,
        "Start with the subject. \"Combining X and Y, the result is Z\" becomes \"Z comes from X and Y.\"",
      ),
    );
  },
};

// ── 6. Rhetorical question openers ───────────────────────────────────────────

export const rhetoricalOpenerRule: Rule = {
  id: "rhetorical-question-opener",
  severity: "block",
  check(ctx) {
    const findings: SlopFinding[] = [];
    for (const block of ctx.blocks) {
      if (block.kind !== "paragraph") continue;
      const first = splitSentences(block.text)[0];
      if (!first?.text.endsWith("?")) continue;
      findings.push(
        finding(
          ctx,
          "rhetorical-question-opener",
          "block",
          { start: block.start, end: block.start + first.text.length },
          "Paragraph opens with a rhetorical question.",
          "Answer it instead. Delete the question and lead with the answer as a statement.",
        ),
      );
    }
    return findings;
  },
};

// ── 7. Placeholder residue ───────────────────────────────────────────────────

const PLACEHOLDERS: readonly { re: RegExp; label: string }[] = [
  { re: /\blorem\s+ipsum\b|\blorem\b/gi, label: "lorem ipsum" },
  { re: /\bTODO\b|\bFIXME\b/g, label: "TODO marker" },
  { re: /\[insert[^\]]*\]/gi, label: "[insert …] placeholder" },
  { re: /\bYour Brand\b|\bBrand Name\b|\bCompany Name\b/gi, label: "unreplaced brand placeholder" },
  { re: /\bexample\.(?:com|org|net)\b/gi, label: "example.com" },
  { re: /\{\{[^}]*\}\}/g, label: "unresolved {{template}}" },
  { re: /\bXXX+\b|\bTBD\b|\bTBC\b/g, label: "TBD marker" },
  { re: /\bLorem\b/g, label: "lorem" },
];

export const placeholderRule: Rule = {
  id: "placeholder-residue",
  severity: "block",
  check(ctx) {
    const findings: SlopFinding[] = [];
    for (const { re, label } of PLACEHOLDERS) {
      re.lastIndex = 0;
      for (const m of ctx.text.matchAll(re)) {
        findings.push(
          finding(
            ctx,
            "placeholder-residue",
            "block",
            { start: m.index ?? 0, end: (m.index ?? 0) + m[0].length },
            `Placeholder left in customer-facing copy: ${label}.`,
            "Replace with the real value. This text is about to be published.",
          ),
        );
      }
    }
    return findings;
  },
};

// ── 7b. Mock-provider fixture filler ─────────────────────────────────────────

/**
 * The placeholder rule above catches the placeholders a *human* leaves behind.
 * It cannot catch the ones this system leaves behind itself.
 *
 * When the mock provider is asked for a string whose field name matches none of
 * its templates, it returns a sentence from FALLBACK_SENTENCES. Those sentences
 * are grammatical, unhedged, free of banned phrases and of every pattern the
 * other rules look for — so an artifact built entirely out of them clears every
 * gate and reports `quality cleared: true`. A green sandbox run therefore proved
 * only that the linter does not recognise its own scaffolding.
 *
 * These are matched verbatim rather than by pattern: they are exact known
 * strings, and tests/contracts/fixture-filler-parity.test.ts fails if the
 * gateway's list and this dictionary ever diverge.
 */
const FIXTURE_FILLER: readonly string[] = fixtureFillerDictionary.sentences;

export const fixtureFillerRule: Rule = {
  id: "fixture-filler",
  severity: "block",
  check(ctx) {
    const findings: SlopFinding[] = [];
    for (const sentence of FIXTURE_FILLER) {
      let from = 0;
      for (;;) {
        const start = ctx.text.indexOf(sentence, from);
        if (start === -1) break;
        findings.push(
          finding(
            ctx,
            "fixture-filler",
            "block",
            { start, end: start + sentence.length },
            "Mock-provider fixture filler reached a quality gate.",
            "This field was never generated — the mock provider had no template for its key. Add a template in packages/model-gateway/templates.ts, or supply the value from the run, before this can be published.",
          ),
        );
        from = start + sentence.length;
      }
    }
    return findings;
  },
};

// ── 8. Emoji in body copy ────────────────────────────────────────────────────

const EMOJI = /\p{Extended_Pictographic}/gu;

export const emojiRule: Rule = {
  id: "emoji-in-body",
  severity: "block",
  check(ctx) {
    if (ctx.options.emojiAllowed) return [];
    return [...ctx.scrubbed.matchAll(EMOJI)].map((m) =>
      finding(
        ctx,
        "emoji-in-body",
        "block",
        { start: m.index ?? 0, end: (m.index ?? 0) + m[0].length },
        "Emoji in body copy, and this brand's voice charter does not enable them.",
        "Remove it, or set emojiAllowed on the voice charter if the brand genuinely uses emoji.",
      ),
    );
  },
};

// ── 9. Heading-to-body ratio ─────────────────────────────────────────────────

export const headingRatioRule: Rule = {
  id: "heading-body-ratio",
  severity: "block",
  check(ctx) {
    const headings = ctx.blocks.filter((b) => b.kind === "heading");
    const body = ctx.blocks.filter((b) => b.kind === "paragraph");
    if (headings.length < THRESHOLDS.headingRatioMinHeadings) return [];
    if (body.length === 0) {
      const first = headings[0];
      return first
        ? [
            finding(
              ctx,
              "heading-body-ratio",
              "block",
              { start: first.start, end: first.end },
              `${headings.length} headings and no body paragraphs.`,
              "Write the prose. A stack of headings is an outline, not a page.",
            ),
          ]
        : [];
    }

    const ratio = headings.length / body.length;
    if (ratio <= THRESHOLDS.headingToBodyRatio) return [];

    const first = headings[0];
    if (!first) return [];
    return [
      finding(
        ctx,
        "heading-body-ratio",
        "block",
        { start: first.start, end: first.end },
        `${headings.length} headings to ${body.length} paragraphs (${ratio.toFixed(2)}); above ${THRESHOLDS.headingToBodyRatio} reads as a listicle.`,
        "Merge sections. Each heading should own at least four paragraphs of real content.",
      ),
    ];
  },
};

export const ALL_RULES: readonly Rule[] = [
  bannedPhraseRule,
  sentenceUniformityRule,
  emDashRule,
  tricolonRule,
  participialOpenerRule,
  rhetoricalOpenerRule,
  placeholderRule,
  fixtureFillerRule,
  emojiRule,
  headingRatioRule,
];
