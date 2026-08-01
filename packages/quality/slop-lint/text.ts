/**
 * Text analysis primitives for the slop linter.
 *
 * Everything here is deterministic and offset-preserving. The linter reports
 * character spans so the UI can highlight the exact offending words and the
 * generating agent gets told precisely what to rewrite — "your copy is generic"
 * produces another generic draft, "these nine words are the problem" does not.
 */

export interface Span {
  readonly start: number;
  readonly end: number;
}

export interface Sentence extends Span {
  readonly text: string;
  readonly wordCount: number;
}

export interface Block extends Span {
  readonly text: string;
  readonly kind: "heading" | "paragraph" | "list-item" | "code";
  readonly level: number;
}

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

export function countWords(text: string): number {
  return (text.match(WORD_RE) ?? []).length;
}

/**
 * Splits into sentences while preserving offsets.
 *
 * Abbreviations are the classic trap: a naive split on `.` turns "approx. 40mm"
 * into two sentences and wrecks every length statistic downstream. The guard
 * list is short on purpose — it covers what actually appears in commercial copy
 * rather than attempting general-purpose NLP.
 */
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "st", "no", "vs", "etc", "e.g", "i.e",
  "approx", "min", "max", "fig", "inc", "ltd", "co", "cm", "mm", "kg", "oz", "ft", "hr",
]);

export function splitSentences(text: string): Sentence[] {
  const sentences: Sentence[] = [];
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== "." && ch !== "!" && ch !== "?") continue;

    // Ellipsis: consume the run, treat as one terminator.
    let j = i;
    while (j + 1 < text.length && (text[j + 1] === "." || text[j + 1] === "!" || text[j + 1] === "?")) j++;

    const next = text[j + 1];
    // A terminator only ends a sentence if whitespace or EOF follows.
    if (next !== undefined && !/\s/.test(next)) {
      i = j;
      continue;
    }

    if (ch === ".") {
      const before = text.slice(Math.max(0, i - 12), i);
      const lastWord = before.match(/([\p{L}.]+)$/u)?.[1]?.toLowerCase();
      if (lastWord && ABBREVIATIONS.has(lastWord.replace(/\.$/, ""))) {
        i = j;
        continue;
      }
      // A single capital before the dot is an initial: "J. Smith".
      if (/(^|\s)\p{Lu}$/u.test(before)) {
        i = j;
        continue;
      }
    }

    const raw = text.slice(start, j + 1);
    const trimmed = raw.trim();
    if (trimmed.length > 0) {
      const lead = raw.length - raw.trimStart().length;
      sentences.push({
        text: trimmed,
        start: start + lead,
        end: start + lead + trimmed.length,
        wordCount: countWords(trimmed),
      });
    }
    start = j + 1;
    i = j;
  }

  const tail = text.slice(start);
  if (tail.trim().length > 0) {
    const lead = tail.length - tail.trimStart().length;
    const trimmed = tail.trim();
    sentences.push({
      text: trimmed,
      start: start + lead,
      end: start + lead + trimmed.length,
      wordCount: countWords(trimmed),
    });
  }

  return sentences;
}

/** Splits Markdown-ish copy into blocks, preserving offsets. */
export function splitBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split("\n");
  let offset = 0;
  let paragraphStart = -1;
  let paragraphLines: string[] = [];
  let inCodeFence = false;

  const flushParagraph = (): void => {
    if (paragraphLines.length === 0) return;
    const joined = paragraphLines.join("\n");
    const trimmed = joined.trim();
    if (trimmed.length > 0) {
      blocks.push({ text: trimmed, kind: "paragraph", level: 0, start: paragraphStart, end: paragraphStart + trimmed.length });
    }
    paragraphLines = [];
    paragraphStart = -1;
  };

  for (const line of lines) {
    const lineStart = offset;
    offset += line.length + 1;

    if (/^\s*```/.test(line)) {
      flushParagraph();
      inCodeFence = !inCodeFence;
      blocks.push({ text: line, kind: "code", level: 0, start: lineStart, end: lineStart + line.length });
      continue;
    }
    if (inCodeFence) continue;

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      blocks.push({
        text: heading[2] ?? "",
        kind: "heading",
        level: heading[1]?.length ?? 1,
        start: lineStart,
        end: lineStart + line.length,
      });
      continue;
    }

    const listItem = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.*)$/);
    if (listItem) {
      flushParagraph();
      blocks.push({ text: listItem[1] ?? "", kind: "list-item", level: 0, start: lineStart, end: lineStart + line.length });
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      continue;
    }

    if (paragraphStart === -1) paragraphStart = lineStart;
    paragraphLines.push(line);
  }

  flushParagraph();
  return blocks;
}

/** Text with code fences blanked out, so rules never fire inside code. */
export function stripCode(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (m) => " ".repeat(m.length))
    .replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length));
}

export function excerptAround(text: string, span: Span, padding = 30): string {
  const start = Math.max(0, span.start - padding);
  const end = Math.min(text.length, span.end + padding);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`;
}
