/** Tolerates markdown fences and leading prose, which models still emit. */
export function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const candidates: string[] = [text.trim()];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) candidates.unshift(fenced[1].trim());

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      return { ok: true, value: JSON.parse(candidate) };
    } catch {
      continue;
    }
  }
  return { ok: false, error: text.slice(0, 200) };
}
