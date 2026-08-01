/**
 * Secret scrubbing for customer data exports.
 *
 * The SQL in `account-data.ts` already selects an explicit column allowlist, so
 * nothing secret should reach here. This is the second layer, and it exists
 * because the first one is a list a human maintains: the day somebody adds a
 * column to an exported table, the allowlist is what gets forgotten.
 *
 * Two independent passes, because either alone leaks:
 *   - **by key name**, which catches `{ apiKey: "hunter2" }` where the value
 *     looks like nothing in particular;
 *   - **by value shape**, which catches a token a customer pasted into a
 *     free-text field that no key-based rule would ever match.
 *
 * Kept in its own module so the question "can a secret leave the building?"
 * has one file to read and one place to test.
 */

const SECRET_KEY =
  /^(?:api[-_]?key|apikey|secret|client[-_]?secret|token|token[-_]?hash|access[-_]?token|refresh[-_]?token|authorization|password|passphrase|private[-_]?key|access[-_]?key|session[-_]?id|cookie|ciphertext|dek[-_]?wrapped|nonce|envelope|signed[-_]?url|card[-_]?number|cvv|iban|ssn|tax[-_]?id)$/i;

const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}\b/g,
  /\bshp(?:at|ca|pa|ss)_[A-Fa-f0-9]{32}\b/g,
  /\bsk-[A-Za-z0-9-_]{20,}\b/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}={0,2}/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /([?&](?:token|key|signature|sig|secret)=)[^&\s]+/gi,
];

/** Dropped entirely rather than redacted — binary in an export is key material. */
const OMIT = Symbol("omit-from-customer-export");

function scrubString(value: string): string {
  let scrubbed = value;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    // These are /g regexes held at module scope, so lastIndex survives between
    // calls and would make the second scrub of an identical string miss.
    pattern.lastIndex = 0;
    scrubbed = scrubbed.replace(pattern, "[redacted]");
  }
  return scrubbed;
}

/** Final defence after the SQL allowlist: removes secret fields and secret-shaped values. */
export function scrubCustomerExport(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === "string") return scrubString(value);
  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (ArrayBuffer.isView(value)) return OMIT;
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry) => scrubCustomerExport(entry, seen)).filter((entry) => entry !== OMIT);
  }

  const scrubbed: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(key)) continue;
    const safe = scrubCustomerExport(entry, seen);
    if (safe !== OMIT) scrubbed[key] = safe;
  }
  return scrubbed;
}
