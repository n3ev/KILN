import { config } from "@kiln/config";
import type { ModelProvider } from "../types.js";
import { createMockProvider } from "./mock.js";
import { createOpenAICompatibleProvider } from "./openai-compatible.js";

export { createMockProvider } from "./mock.js";
export { createOpenAICompatibleProvider } from "./openai-compatible.js";

/**
 * Provider construction.
 *
 * Pricing figures are the operator's responsibility to keep current; they are
 * expressed in micros per 1k tokens and are used only for budget reservation
 * and the cost ledger. Wrong numbers here produce wrong margins, not wrong
 * behaviour — but wrong margins are how a $199/wk product loses money.
 */

export function createKimiProvider(): ModelProvider {
  const cfg = config();
  return createOpenAICompatibleProvider({
    id: "kimi",
    baseUrl: cfg.KIMI_BASE_URL,
    apiKey: cfg.KIMI_API_KEY,
    defaultModel: cfg.KIMI_DEFAULT_MODEL,
    tierModels: { deep: cfg.KIMI_MODEL_DEEP, fast: cfg.KIMI_MODEL_FAST },
    pricing: { promptMicrosPerKTok: 600, completionMicrosPerKTok: 600 },
    capabilities: { toolCalling: true, json: true, contextWindow: 128_000, vision: true },
  });
}

export function createDeepseekProvider(): ModelProvider {
  const cfg = config();
  return createOpenAICompatibleProvider({
    id: "deepseek",
    baseUrl: cfg.DEEPSEEK_BASE_URL,
    apiKey: cfg.DEEPSEEK_API_KEY,
    defaultModel: cfg.DEEPSEEK_DEFAULT_MODEL,
    tierModels: { deep: cfg.DEEPSEEK_MODEL_DEEP, fast: cfg.DEEPSEEK_MODEL_FAST },
    pricing: { promptMicrosPerKTok: 270, completionMicrosPerKTok: 1100 },
    capabilities: { toolCalling: true, json: true, contextWindow: 128_000, vision: false },
    supportsReasoningEffort: true,
  });
}

export function createProvider(id: "kimi" | "deepseek" | "mock"): ModelProvider {
  switch (id) {
    case "kimi":
      return createKimiProvider();
    case "deepseek":
      return createDeepseekProvider();
    case "mock":
      // Jitter only outside tests, so suites are not paced by sleep calls.
      return createMockProvider({
        jitterMs: config().MOCK_STREAM_JITTER_MS ?? (config().NODE_ENV === "test" ? 0 : 12),
      });
  }
}
