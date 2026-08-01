import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

export interface SecretFinding {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly preview: string;
}

const TEXT_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".json", ".html", ".css", ".txt", ".xml"]);
const SECRET_FORMATS: readonly { rule: string; pattern: RegExp }[] = [
  { rule: "private-key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { rule: "stripe-key", pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { rule: "github-token", pattern: /\bgh[opsu]_[A-Za-z0-9]{20,}\b/g },
  { rule: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
  { rule: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { rule: "bearer-token", pattern: /\bBearer\s+[A-Za-z0-9+/_=-]{24,}\b/gi },
];
const SECRET_ASSIGNMENT = /\b(?:api[_-]?key|secret|token|password|credential|private[_-]?key|encryption[_-]?key)\b[^\n]{0,40}?[=:]\s*["']([A-Za-z0-9+/_=.-]{20,})["']/gi;

export function shannonEntropy(value: string): number {
  if (value.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1);
  return [...counts.values()].reduce((entropy, count) => {
    const probability = count / value.length;
    return entropy - probability * Math.log2(probability);
  }, 0);
}

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function preview(value: string): string {
  const compact = value.replace(/\s+/g, " ");
  return compact.length <= 12 ? "[redacted]" : `${compact.slice(0, 4)}…${compact.slice(-4)}`;
}

export function scanText(file: string, text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const { rule, pattern } of SECRET_FORMATS) {
    for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags))) {
      findings.push({ file, line: lineAt(text, match.index ?? 0), rule, preview: preview(match[0]) });
    }
  }
  for (const match of text.matchAll(new RegExp(SECRET_ASSIGNMENT.source, SECRET_ASSIGNMENT.flags))) {
    const candidate = match[1] ?? "";
    // Next.js intentionally generates a server-action encryption key into its
    // server-only manifest. It is not application configuration and never
    // enters a client chunk; treating it as a leaked customer secret makes a
    // clean production build fail on every invocation.
    if (file.endsWith("server-reference-manifest.json") && /encryptionKey/i.test(match[0])) continue;
    if (shannonEntropy(candidate) < 3.5) continue;
    findings.push({
      file,
      line: lineAt(text, match.index ?? 0),
      rule: "high-entropy-secret-assignment",
      preview: preview(candidate),
    });
  }
  return findings;
}

function filesBelow(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (["node_modules", "cache", ".cache", "media"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesBelow(path));
    else if (TEXT_EXTENSIONS.has(extname(path)) && statSync(path).size <= 5_000_000) files.push(path);
  }
  return files;
}

export function scanBuildOutputs(root: string): { scanned: number; findings: SecretFinding[] } {
  const candidates = [
    join(root, "apps", "web", ".next"),
    join(root, "apps", "worker", "dist"),
    join(root, "apps", "mcp", "dist"),
    join(root, "dist"),
  ].filter(existsSync);
  const files = candidates.flatMap(filesBelow);
  return {
    scanned: files.length,
    findings: files.flatMap((file) => scanText(relative(root, file), readFileSync(file, "utf8"))),
  };
}
