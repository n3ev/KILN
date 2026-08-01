import type { ModelTier, ProviderId } from "@kiln/config";
import { config } from "@kiln/config";
import { ProviderUnavailable } from "@kiln/contracts";
import { logger } from "@kiln/observability";
import { approximateTokens } from "./mock.js";
import type {
  ChatChunk,
  ChatMessage,
  ChatRequest,
  ChatResult,
  ModelProvider,
  ModelSelector,
  ProviderCapabilities,
  ProviderPricing,
  ToolCallRequest,
} from "../types.js";

/**
 * Shared implementation for OpenAI-compatible endpoints (Moonshot/Kimi and
 * DeepSeek both expose one).
 *
 * **No model id is hardcoded anywhere, including in defaults.** Both vendors
 * rename and retire model ids on their own schedule, and a constant buried in
 * source is how a product breaks silently three months after launch. Tiers
 * resolve through `MODEL_TIER_MAP`; an unmapped tier falls back to the
 * provider's configured default and logs a warning.
 */

export interface OpenAICompatibleSpec {
  readonly id: ProviderId;
  readonly baseUrl: string;
  readonly apiKey: string | undefined;
  readonly defaultModel: string | undefined;
  /** Compatibility for the documented per-tier env vars; MODEL_TIER_MAP wins. */
  readonly tierModels?: Partial<Record<ModelTier, string | undefined>>;
  readonly pricing: ProviderPricing;
  readonly capabilities: ProviderCapabilities;
  /** DeepSeek's reasoning variant accepts this; Moonshot ignores it. */
  readonly supportsReasoningEffort?: boolean;
}

interface ChoiceDelta {
  content?: string | null;
  tool_calls?: {
    index: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }[];
}

interface StreamEvent {
  choices?: { delta?: ChoiceDelta; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function toWireMessages(messages: readonly ChatMessage[]): Record<string, unknown>[] {
  return messages.map((m) => {
    if (m.role === "tool") {
      return { role: "tool", content: m.content, tool_call_id: m.toolCallId };
    }
    if (m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: m.role,
        content: m.content,
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: JSON.stringify(c.arguments) },
        })),
      };
    }
    return { role: m.role, content: m.content };
  });
}

export function createOpenAICompatibleProvider(spec: OpenAICompatibleSpec): ModelProvider {
  function resolveModel(selector: ModelSelector): string | undefined {
    if (selector.modelId) return selector.modelId;

    const mapped = config().MODEL_TIER_MAP[spec.id]?.[selector.tier];
    if (mapped && mapped.length > 0) return mapped;

    const tierModel = spec.tierModels?.[selector.tier];
    if (tierModel && tierModel.length > 0) return tierModel;

    if (spec.defaultModel) {
      logger.warn("model tier is unmapped; using the provider default", {
        provider: spec.id,
        tier: selector.tier,
        hint: `Set MODEL_TIER_MAP.${spec.id}.${selector.tier} to pin this.`,
      });
      return spec.defaultModel;
    }
    return undefined;
  }

  function buildBody(req: ChatRequest, model: string, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model,
      messages: toWireMessages(req.messages),
      stream,
    };
    if (req.temperature !== undefined) body["temperature"] = req.temperature;
    if (req.maxTokens !== undefined) body["max_tokens"] = req.maxTokens;
    if (req.json && spec.capabilities.json) body["response_format"] = { type: "json_object" };
    if (req.tools && req.tools.length > 0 && spec.capabilities.toolCalling) {
      body["tools"] = req.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }
    if (req.reasoningEffort && spec.supportsReasoningEffort) {
      body["reasoning_effort"] = req.reasoningEffort;
    }
    return body;
  }

  async function post(req: ChatRequest, stream: boolean): Promise<{ response: Response; model: string }> {
    if (!spec.apiKey) throw new ProviderUnavailable(spec.id, "no API key configured");

    const model = resolveModel(req.selector);
    if (!model) {
      throw new ProviderUnavailable(
        spec.id,
        `no model id for tier "${req.selector.tier}". Set MODEL_TIER_MAP or ${spec.id.toUpperCase()}_DEFAULT_MODEL.`,
      );
    }

    const response = await fetch(`${spec.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${spec.apiKey}`,
      },
      body: JSON.stringify(buildBody(req, model, stream)),
      ...(req.signal ? { signal: req.signal } : {}),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      // 429 and 5xx are retryable; the gateway's breaker decides, not us.
      throw new ProviderUnavailable(spec.id, `HTTP ${response.status}: ${detail.slice(0, 400)}`);
    }
    return { response, model };
  }

  function accumulateToolCalls(
    acc: Map<number, { id: string; name: string; args: string }>,
    deltas: NonNullable<ChoiceDelta["tool_calls"]>,
  ): void {
    for (const d of deltas) {
      const existing = acc.get(d.index) ?? { id: d.id ?? `call_${d.index}`, name: "", args: "" };
      if (d.id) existing.id = d.id;
      if (d.function?.name) existing.name = d.function.name;
      if (d.function?.arguments) existing.args += d.function.arguments;
      acc.set(d.index, existing);
    }
  }

  function finaliseToolCalls(acc: Map<number, { id: string; name: string; args: string }>): ToolCallRequest[] {
    return [...acc.values()].map((c) => {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = c.args.trim().length > 0 ? (JSON.parse(c.args) as Record<string, unknown>) : {};
      } catch {
        // Malformed arguments are a real failure mode; surfacing the raw string
        // lets the runtime's repair path see what the model actually emitted.
        parsed = { __unparsed: c.args };
      }
      return { id: c.id, name: c.name, arguments: parsed };
    });
  }

  return {
    id: spec.id,
    pricing: spec.pricing,
    capabilities: spec.capabilities,
    resolveModel,
    countTokens: approximateTokens,

    async complete(req: ChatRequest): Promise<ChatResult> {
      const { response, model } = await post(req, false);
      const payload = (await response.json()) as {
        choices?: { message?: { content?: string; tool_calls?: unknown[] }; finish_reason?: string }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      const choice = payload.choices?.[0];
      const acc = new Map<number, { id: string; name: string; args: string }>();
      const rawCalls = (choice?.message?.tool_calls ?? []) as {
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
      rawCalls.forEach((c, i) =>
        acc.set(i, { id: c.id ?? `call_${i}`, name: c.function?.name ?? "", args: c.function?.arguments ?? "" }),
      );

      return {
        text: choice?.message?.content ?? "",
        toolCalls: finaliseToolCalls(acc),
        finishReason: choice?.finish_reason === "tool_calls" ? "tool-calls" : "stop",
        usage: {
          promptTokens: payload.usage?.prompt_tokens ?? 0,
          completionTokens: payload.usage?.completion_tokens ?? 0,
        },
        model,
        provider: spec.id,
      };
    },

    async *chat(req: ChatRequest): AsyncIterable<ChatChunk> {
      const { response, model } = await post(req, true);
      const body = response.body;
      if (!body) throw new ProviderUnavailable(spec.id, "streaming response had no body");

      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
      let finishReason: ChatResult["finishReason"] = "stop";
      const toolAcc = new Map<number, { id: string; name: string; args: string }>();
      let usage = { promptTokens: 0, completionTokens: 0 };

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE frames are separated by a blank line; a frame can straddle
          // chunk boundaries, so the tail stays in the buffer.
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            const line = frame.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") continue;

            let event: StreamEvent;
            try {
              event = JSON.parse(data) as StreamEvent;
            } catch {
              continue;
            }

            const delta = event.choices?.[0]?.delta;
            if (delta?.content) {
              text += delta.content;
              yield { type: "text", text: delta.content };
            }
            if (delta?.tool_calls) accumulateToolCalls(toolAcc, delta.tool_calls);
            if (event.choices?.[0]?.finish_reason === "tool_calls") finishReason = "tool-calls";
            if (event.usage) {
              usage = {
                promptTokens: event.usage.prompt_tokens ?? usage.promptTokens,
                completionTokens: event.usage.completion_tokens ?? usage.completionTokens,
              };
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      const toolCalls = finaliseToolCalls(toolAcc);
      for (const call of toolCalls) yield { type: "tool-call", call };

      yield {
        type: "done",
        result: {
          text,
          toolCalls,
          finishReason,
          usage: {
            promptTokens: usage.promptTokens || req.messages.reduce((n, m) => n + approximateTokens(m.content), 0),
            completionTokens: usage.completionTokens || approximateTokens(text),
          },
          model,
          provider: spec.id,
        },
      };
    },
  };
}
