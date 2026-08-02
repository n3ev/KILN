/**
 * Answers one question: is the configured model provider actually reachable,
 * or is the gateway quietly serving fixtures?
 *
 * The distinction is invisible from the UI by design — the fallback chain ends
 * at `mock` so a run degrades rather than dies — so a provider that is
 * misconfigured, rate-limited, or pointed at a retired model id looks exactly
 * like one that works. This makes one real call per tier and reports which
 * provider answered.
 *
 *   pnpm model:smoke
 */
import { readFileSync } from "node:fs";
import { config } from "../packages/config/env.js";
import { gateway, resetGateway } from "../packages/model-gateway/index.js";

/**
 * Reports keys the file defines that the shell has already set to something
 * else. loadEnvFile deliberately does not override an inherited variable, so a
 * stale `source .env` in the current terminal silently beats every later edit
 * to the file — which looks exactly like the edit not saving.
 */
function shadowedKeys(path: string): string[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const shadowed: string[] = [];
  for (const line of raw.split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    if (key === undefined || value === undefined) continue;
    const fromFile = value.trim().replace(/^["']|["']$/g, "").split(/\s+#/)[0]?.trim();
    const fromEnv = process.env[key];
    if (fromEnv !== undefined && fromFile !== undefined && fromEnv !== fromFile) shadowed.push(key);
  }
  return shadowed;
}

const shadowed = shadowedKeys(".env");

// config() is lazy, so reading the file here is both necessary and early enough.
try {
  process.loadEnvFile(".env");
} catch {
  console.log("no .env found; reading the ambient environment\n");
}

const cfg = config();

console.log("configured provider   ", cfg.MODEL_PROVIDER);
console.log("fallback order        ", cfg.MODEL_FALLBACK_ORDER.join(" -> "));
console.log("providers with a key  ", cfg.availableProviders.join(", "));
console.log("tier map              ", JSON.stringify(cfg.MODEL_TIER_MAP));
console.log();

if (shadowed.length > 0) {
  console.log(`Your shell overrides .env for: ${shadowed.join(", ")}`);
  console.log("The shell value wins. Open a new terminal, or unset those names.\n");
}

if (!cfg.availableProviders.some((p) => p !== "mock")) {
  console.error("No live provider has a credential. Every call would serve fixtures.");
  process.exit(1);
}

resetGateway();

// Reasoning models spend completion tokens thinking before they write, so a
// tight cap returns an empty string and still bills for it. The deep tier gets
// room to finish; finishReason exposes the case where it did not.
const BUDGET: Record<string, number> = { fast: 200, deep: 800 };

for (const tier of ["fast", "deep"] as const) {
  const started = Date.now();
  try {
    const result = await gateway().complete({
      selector: { tier },
      temperature: 0,
      maxTokens: BUDGET[tier],
      context: { agentId: "smoke", taskKind: "provider-reachability", seed: "smoke" },
      messages: [
        { role: "system", content: "Reply with exactly one short sentence. No preamble." },
        { role: "user", content: "Name the capital of Portugal." },
      ],
    });

    const live = result.provider !== "mock";
    const text = result.text.trim();
    console.log(`${tier.padEnd(5)} ${live ? "LIVE" : "MOCK"}  ${result.provider}/${result.model}`);
    console.log(
      `      ${Date.now() - started}ms  ${result.usage.promptTokens}+${result.usage.completionTokens} tokens` +
        `  finish=${result.finishReason}${result.degraded ? "  DEGRADED" : ""}`,
    );
    console.log(`      ${text.length > 0 ? text.slice(0, 160) : "(empty — raise maxTokens if finish=length)"}`);
  } catch (error) {
    console.log(`${tier.padEnd(5)} FAILED  ${(error as Error).message}`);
  }
  console.log();
}
