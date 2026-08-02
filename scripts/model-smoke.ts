/**
 * Answers one question: is the configured model provider actually reachable,
 * or is the gateway quietly serving fixtures?
 *
 * The distinction is invisible from the UI by design — the fallback chain ends
 * at `mock` so a run degrades rather than dies — so a provider that is
 * misconfigured, rate-limited, or pointed at a retired model id looks exactly
 * like one that works. This makes one real call and reports which provider
 * answered.
 *
 *   pnpm model:smoke
 */
import { config } from "../packages/config/env.js";
import { gateway, resetGateway } from "../packages/model-gateway/index.js";

// Nothing outside scripts/dev.sh loads .env, and config() is lazy, so reading
// the file here is both necessary and early enough.
try {
  process.loadEnvFile(".env");
} catch {
  console.log("no .env found; reading the ambient environment\n");
}

const cfg = config();

console.log("configured provider   ", cfg.MODEL_PROVIDER);
console.log("fallback order        ", cfg.MODEL_FALLBACK_ORDER.join(" -> "));
console.log("providers with a key  ", cfg.availableProviders.join(", "));
console.log("tier map              ", JSON.stringify(cfg.MODEL_TIER_MAP ?? {}));
console.log();

if (!cfg.availableProviders.some((p) => p !== "mock")) {
  console.error("No live provider has a credential. Every call would serve fixtures.");
  process.exit(1);
}

resetGateway();

for (const tier of ["fast", "deep"] as const) {
  const started = Date.now();
  try {
    const result = await gateway().complete({
      selector: { tier },
      temperature: 0,
      maxTokens: 32,
      context: { agentId: "smoke", taskKind: "provider-reachability", seed: "smoke" },
      messages: [
        { role: "system", content: "Reply with exactly one short sentence. No preamble." },
        { role: "user", content: "Name the capital of Portugal." },
      ],
    });

    const live = result.provider !== "mock";
    console.log(`${tier.padEnd(5)} ${live ? "LIVE" : "MOCK"}  ${result.provider}/${result.model}`);
    console.log(`      ${Date.now() - started}ms  ${result.usage.promptTokens}+${result.usage.completionTokens} tokens${result.degraded ? "  DEGRADED" : ""}`);
    console.log(`      ${result.text.trim().slice(0, 120)}`);
  } catch (error) {
    console.log(`${tier.padEnd(5)} FAILED  ${(error as Error).message}`);
  }
  console.log();
}
