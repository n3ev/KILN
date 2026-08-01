import type { ProviderId } from "@kiln/config";
import { config } from "@kiln/config";
import { ProviderUnavailable, SchemaViolation, SyntheticResponseFailure } from "@kiln/contracts";
import { logger, modelCostMicros, redactMessages, withSpan } from "@kiln/observability";
import type { z } from "zod";
import { saveFixture } from "./fixtures.js";
import { tryParseJson } from "./parse.js";
import { createProvider } from "./providers/index.js";
import type {
  ChatChunk,
  ChatRequest,
  ChatResult,
  GeneratedObject,
  GenerateObjectOptions,
  ModelSelector,
  ModelProvider,
} from "./types.js";

/**
 * The gateway.
 *
 * Sits between agents and providers and owns everything that must be true
 * regardless of which model answers: redaction, retries, circuit breaking,
 * fallback, cost accounting, and structured-output validation.
 */

export interface CostSink {
  /** Called after every completed call, before the result is returned. */
  record(entry: {
    provider: ProviderId;
    model: string;
    promptTokens: number;
    completionTokens: number;
    costMicros: number;
    agentId: string;
    runId?: string;
    taskId?: string;
  }): Promise<void> | void;
}

/**
 * Reserves budget *before* the request goes out. Throwing here is the whole
 * point: a call that would exceed the envelope must never reach the network.
 */
export interface BudgetGuard {
  reserve(category: "model", estimatedMicros: number, ref: string): Promise<void> | void;
  settle(ref: string, actualMicros: number): Promise<void> | void;
  release(ref: string): Promise<void> | void;
}

export interface GatewayOptions {
  readonly order?: readonly ProviderId[];
  readonly costSink?: CostSink;
  readonly budget?: BudgetGuard;
  readonly maxRetries?: number;
  /** Consecutive failures before a provider is skipped. */
  readonly breakerThreshold?: number;
  readonly breakerCooldownMs?: number;
}

interface BreakerState {
  failures: number;
  openedAt?: number;
}

const RETRYABLE = /HTTP (429|5\d\d)|ECONNRESET|ETIMEDOUT|fetch failed/i;

export class ModelGateway {
  private readonly providers = new Map<ProviderId, ModelProvider>();
  private readonly breakers = new Map<ProviderId, BreakerState>();
  private readonly order: readonly ProviderId[];
  private readonly maxRetries: number;
  private readonly breakerThreshold: number;
  private readonly breakerCooldownMs: number;

  constructor(private readonly options: GatewayOptions = {}) {
    this.order = options.order ?? config().availableProviders;
    this.maxRetries = options.maxRetries ?? 3;
    this.breakerThreshold = options.breakerThreshold ?? 4;
    this.breakerCooldownMs = options.breakerCooldownMs ?? 30_000;
  }

  private provider(id: ProviderId): ModelProvider {
    let p = this.providers.get(id);
    if (!p) {
      p = createProvider(id);
      this.providers.set(id, p);
    }
    return p;
  }

  private isOpen(id: ProviderId): boolean {
    const state = this.breakers.get(id);
    if (!state?.openedAt) return false;
    if (Date.now() - state.openedAt > this.breakerCooldownMs) {
      // Half-open: let one request through to test the water.
      this.breakers.set(id, { failures: 0 });
      return false;
    }
    return true;
  }

  private recordFailure(id: ProviderId): void {
    const state = this.breakers.get(id) ?? { failures: 0 };
    state.failures++;
    if (state.failures >= this.breakerThreshold) {
      state.openedAt = Date.now();
      logger.warn("model provider circuit opened", { provider: id, failures: state.failures });
    }
    this.breakers.set(id, state);
  }

  private recordSuccess(id: ProviderId): void {
    this.breakers.set(id, { failures: 0 });
  }

  /** Providers to try, in order, skipping any whose breaker is open. */
  private chain(): ProviderId[] {
    const usable = this.order.filter((id) => !this.isOpen(id));
    // The chain always terminates at mock so a run degrades rather than dies.
    return usable.includes("mock") ? usable : [...usable, "mock"];
  }

  /** The configured primary, even when its circuit breaker is currently open. */
  primaryProviderId(): ProviderId {
    return this.order[0] ?? "mock";
  }

  /** Resolves the provider/model label before streaming starts. */
  primarySelection(selector: ModelSelector): { provider: ProviderId; model: string } {
    const provider = this.primaryProviderId();
    const model = this.provider(provider).resolveModel(selector) ?? `unmapped:${selector.tier}`;
    return { provider, model };
  }

  /** Uses the same pricing table as reservation and ledger accounting. */
  resultCostMicros(result: ChatResult): number {
    const provider = this.provider(result.provider);
    return modelCostMicros(result.usage.promptTokens, result.usage.completionTokens, provider.pricing);
  }

  private estimateMicros(req: ChatRequest, provider: ModelProvider): number {
    const promptTokens = req.messages.reduce((n, m) => n + provider.countTokens(m.content), 0);
    const assumedCompletion = req.maxTokens ?? 1500;
    return modelCostMicros(promptTokens, assumedCompletion, provider.pricing);
  }

  private prepare(req: ChatRequest): ChatRequest {
    // Redaction happens once, here, so no provider adapter can forget it.
    return { ...req, messages: redactMessages(req.messages) };
  }

  async complete(request: ChatRequest): Promise<ChatResult> {
    const req = this.prepare(request);
    const chain = this.chain();
    let lastError: unknown;

    for (const [index, id] of chain.entries()) {
      const provider = this.provider(id);
      const ref = `${req.context.taskId ?? req.context.agentId}:${id}:${Date.now()}`;
      const estimate = this.estimateMicros(req, provider);

      // Throws BudgetExceeded before the request is made.
      await this.options.budget?.reserve("model", estimate, ref);

      try {
        const result = await withSpan(
          `model.complete:${id}`,
          async () => this.withRetries(() => provider.complete(req), id),
          undefined,
          { provider: id, agentId: req.context.agentId, tier: req.selector.tier },
        );

        this.recordSuccess(id);

        const cost = modelCostMicros(result.usage.promptTokens, result.usage.completionTokens, provider.pricing);
        await this.options.budget?.settle(ref, cost);
        await this.options.costSink?.record({
          provider: id,
          model: result.model,
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          costMicros: cost,
          agentId: req.context.agentId,
          ...(req.context.runId ? { runId: req.context.runId } : {}),
          ...(req.context.taskId ? { taskId: req.context.taskId } : {}),
        });

        if (config().MODEL_RECORD && id !== "mock") saveFixture(req, result);

        // Anything answered by a fallback is marked, and the runtime stamps
        // quality.degraded on artifacts built from it.
        return id === this.primaryProviderId() && index === 0
          ? result
          : { ...result, degraded: true };
      } catch (error) {
        await this.options.budget?.release(ref);

        // A synthesis failure is a real defect in the schema or the corpus, not
        // a transient provider problem. Failing over would hide it.
        if (error instanceof SyntheticResponseFailure) throw error;

        lastError = error;
        this.recordFailure(id);
        const next = chain[index + 1];
        logger.warn("model provider failed; falling back", {
          provider: id,
          nextProvider: next ?? "none",
          error: String(error),
        });
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new ProviderUnavailable("mock", `every provider in the chain failed: ${String(lastError)}`);
  }

  /** Streaming. Falls back only before the first token — never mid-stream. */
  async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
    const req = this.prepare(request);
    const chain = this.chain();
    let lastError: unknown;

    for (const [index, id] of chain.entries()) {
      const provider = this.provider(id);
      const ref = `${req.context.taskId ?? req.context.agentId}:${id}:stream:${Date.now()}`;
      const estimate = this.estimateMicros(req, provider);
      await this.options.budget?.reserve("model", estimate, ref);
      let emitted = false;
      let settled = false;
      try {
        for await (const chunk of provider.chat(req)) {
          if (chunk.type !== "done") {
            emitted = true;
            yield chunk;
            continue;
          }

          const result = id === this.primaryProviderId() && index === 0
            ? chunk.result
            : { ...chunk.result, degraded: true as const };
          const cost = modelCostMicros(
            result.usage.promptTokens,
            result.usage.completionTokens,
            provider.pricing,
          );
          await this.options.budget?.settle(ref, cost);
          settled = true;
          await this.options.costSink?.record({
            provider: id,
            model: result.model,
            promptTokens: result.usage.promptTokens,
            completionTokens: result.usage.completionTokens,
            costMicros: cost,
            agentId: req.context.agentId,
            ...(req.context.runId ? { runId: req.context.runId } : {}),
            ...(req.context.taskId ? { taskId: req.context.taskId } : {}),
          });
          if (config().MODEL_RECORD && id !== "mock") saveFixture(req, result);
          this.recordSuccess(id);
          yield { type: "done", result };
          return;
        }
        throw new ProviderUnavailable(id, "stream ended without a completion record");
      } catch (error) {
        if (!settled) await this.options.budget?.release(ref);
        lastError = error;
        if (error instanceof SyntheticResponseFailure) throw error;
        this.recordFailure(id);
        if (emitted) throw error;
        logger.warn("streaming provider failed before first token", { provider: id, error: String(error) });
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new ProviderUnavailable("mock", "no provider produced a stream");
  }

  private async streamingComplete(
    request: ChatRequest,
    onToken: (text: string) => Promise<void> | void,
  ): Promise<ChatResult> {
    let result: ChatResult | undefined;
    for await (const chunk of this.chat(request)) {
      if (chunk.type === "text") await onToken(chunk.text);
      if (chunk.type === "done") result = chunk.result;
    }
    if (!result) throw new ProviderUnavailable("mock", "stream completed without a final result");
    return result;
  }

  private async withRetries<T>(fn: () => Promise<T>, id: ProviderId): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (!RETRYABLE.test(String(error))) throw error;
        // Exponential backoff with full jitter.
        const base = 250 * 2 ** attempt;
        const delay = Math.random() * base;
        logger.debug("retrying model call", { provider: id, attempt: attempt + 1, delayMs: Math.round(delay) });
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastError;
  }

  /**
   * Structured output.
   *
   * Requests JSON, validates against the schema, and on failure re-prompts with
   * the validation errors attached — the model is far better at fixing a named
   * error than at guessing what "invalid" meant. After `maxAttempts`, throws
   * `SchemaViolation` rather than returning something the caller must re-check.
   */
  async generateObjectDetailed<T extends z.ZodTypeAny>(
    opts: GenerateObjectOptions<T>,
  ): Promise<GeneratedObject<z.infer<T>>> {
    const maxAttempts = opts.maxAttempts ?? 3;
    const messages = [...opts.request.messages];
    let issues: { path: string; message: string }[] = [];

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const call = {
        ...opts.request,
        messages,
        json: true,
        outputSchema: opts.schema,
      };
      const result = opts.onToken
        ? await this.streamingComplete(call, opts.onToken)
        : await this.complete(call);

      const parsed = tryParseJson(result.text);
      if (parsed.ok) {
        const validated = opts.schema.safeParse(parsed.value);
        if (validated.success) {
          return { data: validated.data as z.infer<T>, response: result };
        }
        issues = validated.error.issues.map((i) => ({
          path: i.path.join(".") || "(root)",
          message: i.message,
        }));
      } else {
        issues = [{ path: "(root)", message: `response was not valid JSON: ${parsed.error}` }];
      }

      if (attempt === maxAttempts) break;

      messages.push({ role: "assistant", content: result.text });
      messages.push({
        role: "user",
        content: [
          `Your response did not match the required ${opts.schemaName ?? "output"} schema.`,
          "Fix exactly these problems and return the corrected JSON only:",
          ...issues.map((i) => `  - ${i.path}: ${i.message}`),
          "",
          "Return a single JSON object. No prose, no markdown fences.",
        ].join("\n"),
      });

      logger.debug("re-prompting after schema violation", {
        agentId: opts.request.context.agentId,
        attempt,
        issueCount: issues.length,
      });
    }

    throw new SchemaViolation(maxAttempts, issues, {
      agentId: opts.request.context.agentId,
      taskKind: opts.request.context.taskKind,
    });
  }

  async generateObject<T extends z.ZodTypeAny>(opts: GenerateObjectOptions<T>): Promise<z.infer<T>> {
    return (await this.generateObjectDetailed(opts)).data;
  }
}

let shared: ModelGateway | undefined;

export function gateway(options?: GatewayOptions): ModelGateway {
  if (options) return new ModelGateway(options);
  shared ??= new ModelGateway();
  return shared;
}

export function resetGateway(): void {
  shared = undefined;
}
