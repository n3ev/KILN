/**
 * Redaction.
 *
 * CLAUDE.md §7: no secret, credential, or PII field ever enters a prompt. This
 * module is the rule set that enforces it, and it runs on every message the
 * model gateway sends and on everything written to a log or a run event.
 *
 * Two layers, because either alone leaks:
 *
 *   - **Key-based**: any object key whose name looks like a secret has its
 *     value replaced regardless of what the value looks like. Catches
 *     `{ apiKey: "hunter2" }`, which no pattern would match.
 *   - **Pattern-based**: values that look like credentials are replaced
 *     regardless of the key they sit under. Catches a token pasted into a
 *     free-text field by a customer.
 *
 * Redaction is deliberately lossy and irreversible. If you need the value, you
 * are in the tool execution boundary and should be leasing it from the vault.
 */

export const REDACTED = "[redacted]";

/** Object keys whose values are never safe to emit. Matched case-insensitively. */
export const SENSITIVE_KEYS: readonly RegExp[] = [
  /^(api[-_]?key|apikey)$/i,
  /^(secret|client[-_]?secret)$/i,
  /(^|_)token$/i,
  /^authorization$/i,
  /^password$/i,
  /^passphrase$/i,
  /^private[-_]?key$/i,
  /^access[-_]?key/i,
  /^refresh[-_]?token$/i,
  /^session[-_]?id$/i,
  /^cookie$/i,
  /^ciphertext$/i,
  /^dek[-_]?wrapped$/i,
  /^nonce$/i,
  /^card[-_]?number$/i,
  /^cvv$/i,
  /^iban$/i,
  /^ssn$/i,
  /^tax[-_]?id$/i,
];

export interface RedactionRule {
  readonly name: string;
  readonly pattern: RegExp;
  /** Replacement, or a function for partial masking. */
  readonly replace: (match: string) => string;
}

const keepLast4 = (m: string): string => `${REDACTED}:${m.slice(-4)}`;

/**
 * Value patterns. Ordered most-specific first — a Stripe key would also match
 * the generic long-token rule, and the specific name is more useful in a log.
 */
export const VALUE_RULES: readonly RedactionRule[] = [
  { name: "stripe-key", pattern: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}\b/g, replace: keepLast4 },
  { name: "shopify-token", pattern: /\bshp(?:at|ca|pa|ss)_[A-Fa-f0-9]{32}\b/g, replace: keepLast4 },
  { name: "openai-style-key", pattern: /\bsk-[A-Za-z0-9-_]{20,}\b/g, replace: keepLast4 },
  { name: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, replace: keepLast4 },
  { name: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, replace: keepLast4 },
  { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, replace: () => REDACTED },
  { name: "bearer", pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}={0,2}/gi, replace: () => `Bearer ${REDACTED}` },
  { name: "pem-block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replace: () => REDACTED },
  { name: "email", pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replace: (m) => `${REDACTED}@${m.split("@")[1] ?? ""}` },
  { name: "card-number", pattern: /\b(?:\d[ -]*?){13,19}\b/g, replace: keepLast4 },
];

export function redactString(input: string): string {
  let output = input;
  for (const rule of VALUE_RULES) {
    output = output.replace(rule.pattern, (m) => rule.replace(m));
  }
  return output;
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.some((re) => re.test(key));
}

/**
 * Deep-redacts an arbitrary value. Cycles are handled, because run payloads
 * occasionally carry a self-referential structure and a stack overflow inside
 * the logger is a spectacularly unhelpful failure.
 */
export function redact<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (typeof value === "string") return redactString(value) as unknown as T;
  if (value === null || typeof value !== "object") return value;

  if (seen.has(value as object)) return "[circular]" as unknown as T;
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((v) => redact(v, seen)) as unknown as T;
  }

  if (value instanceof Date) return value;
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) } as unknown as T;
  }
  // Buffers and typed arrays are almost always key material in this codebase.
  if (ArrayBuffer.isView(value)) return REDACTED as unknown as T;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = isSensitiveKey(k) ? REDACTED : redact(v, seen);
  }
  return out as unknown as T;
}

/** Convenience for the gateway: redacts an array of chat messages in place. */
export function redactMessages<T extends { content: unknown }>(messages: readonly T[]): T[] {
  return messages.map((m) => ({ ...m, content: redact(m.content) }));
}
