import { fixtureKey, inputDigest, loadFixture } from "../fixtures.js";
import { createRng } from "../rng.js";
import { synthesize } from "../synth.js";
import { synthString } from "../templates.js";
import type {
  ChatChunk,
  ChatRequest,
  ChatResult,
  ModelProvider,
  ModelSelector,
  ProviderCapabilities,
  ProviderPricing,
} from "../types.js";

/**
 * The mock provider — the most important adapter in the codebase.
 *
 * It is the default when no key is present, which means it is what a new
 * developer, a demo run, and the entire test suite all exercise. If it produces
 * junk, the product looks like junk to everyone who has not yet paid.
 *
 * Order of resolution:
 *   1. A recorded fixture, if one matches (agentId, taskKind, inputDigest).
 *   2. Synthesis from the caller's expected Zod schema, which yields coherent,
 *      schema-valid output for inputs nobody has recorded.
 *   3. If synthesis cannot satisfy the schema, `SyntheticResponseFailure`
 *      propagates. It is never swallowed and never partially satisfied.
 */

/** Free, but priced so cost-accounting code paths are genuinely exercised. */
const PRICING: ProviderPricing = { promptMicrosPerKTok: 0, completionMicrosPerKTok: 0 };

const CAPABILITIES: ProviderCapabilities = {
  toolCalling: true,
  json: true,
  contextWindow: 128_000,
  vision: false,
};

/** Rough but stable: ~4 characters per token holds well enough for budgeting. */
export function approximateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export interface MockOptions {
  /** Streaming delay per chunk. Zero in tests, non-zero in dev. */
  readonly jitterMs?: number;
  /** Fail the Nth call, to exercise fallback and repair paths. */
  readonly failOnCall?: number;
}

export function createMockProvider(options: MockOptions = {}): ModelProvider {
  let callCount = 0;

  function buildResult(req: ChatRequest): ChatResult {
    const fixture = loadFixture(fixtureKey(req));
    if (fixture) {
      return { ...fixture.result, provider: "mock", model: `mock:${fixture.model}` };
    }

    const seed = [
      req.context.seed,
      req.context.agentId,
      req.context.taskKind,
      inputDigest(req),
    ].join("::");

    // Schema-driven synthesis. Throws SyntheticResponseFailure on an
    // unsatisfiable schema — deliberately not caught here.
    const text = req.outputSchema
      ? JSON.stringify(synthesize(req.outputSchema, seed), null, 2)
      : synthString({ key: req.context.taskKind, path: [req.context.taskKind], rng: createRng(seed) });

    const promptTokens = req.messages.reduce((n, m) => n + approximateTokens(m.content), 0);

    return {
      text,
      toolCalls: [],
      finishReason: "stop",
      usage: { promptTokens, completionTokens: approximateTokens(text) },
      model: "mock:synthetic",
      provider: "mock",
    };
  }

  return {
    id: "mock",
    pricing: PRICING,
    capabilities: CAPABILITIES,

    resolveModel(selector: ModelSelector): string {
      return selector.modelId ?? `mock:${selector.tier}`;
    },

    countTokens: approximateTokens,

    async complete(req: ChatRequest): Promise<ChatResult> {
      callCount++;
      if (options.failOnCall !== undefined && callCount === options.failOnCall) {
        throw new Error(`mock provider: deliberate failure on call ${callCount}`);
      }
      return buildResult(req);
    },

    /**
     * Streams token-by-token with jitter so the Run Theatre is genuinely
     * exercised offline. A mock that returns everything in one chunk hides
     * every streaming bug until the first day a real key is configured.
     */
    async *chat(req: ChatRequest): AsyncIterable<ChatChunk> {
      callCount++;
      if (options.failOnCall !== undefined && callCount === options.failOnCall) {
        throw new Error(`mock provider: deliberate failure on call ${callCount}`);
      }

      const result = buildResult(req);
      const rng = createRng(`${req.context.seed}::stream`);
      const jitter = options.jitterMs ?? 0;

      // Split on whitespace boundaries so partial JSON stays recognisable.
      const chunks = result.text.match(/\S+\s*/g) ?? [result.text];
      for (const chunk of chunks) {
        if (req.signal?.aborted) break;
        if (jitter > 0) await new Promise((r) => setTimeout(r, rng.int(1, jitter)));
        yield { type: "text", text: chunk };
      }

      for (const call of result.toolCalls) yield { type: "tool-call", call };
      yield { type: "done", result };
    },
  };
}
