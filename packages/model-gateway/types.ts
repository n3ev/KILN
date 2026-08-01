import type { ModelTier, ProviderId } from "@kiln/config";
import type { z } from "zod";

/** The provider abstraction. Everything above this line is provider-agnostic. */

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Set on assistant messages that requested tools. */
  toolCalls?: ToolCallRequest[];
  /** Set on tool messages, correlating the result to its request. */
  toolCallId?: string;
  name?: string;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolSchema {
  name: string;
  description: string;
  /** JSON Schema for the tool's input. */
  parameters: Record<string, unknown>;
}

export interface ModelSelector {
  tier: ModelTier;
  /** Overrides the tier map. Use only when a specific model is genuinely required. */
  modelId?: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  selector: ModelSelector;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolSchema[];
  /** Ask the provider for JSON. Providers without native support get a nudge. */
  json?: boolean;
  /** Passed through by reasoning-capable providers, ignored by the rest. */
  reasoningEffort?: "low" | "medium" | "high";
  /**
   * The shape the caller expects back.
   *
   * Live providers use it only to describe the target JSON in the prompt. The
   * mock provider uses it to *synthesise* a valid response on a fixture miss,
   * which is what lets an unseen input still produce a coherent run instead of
   * an error. Set automatically by `generateObject`.
   */
  outputSchema?: z.ZodTypeAny;
  /** Identifies the caller for fixtures, cost attribution, and tracing. */
  context: RequestContext;
  signal?: AbortSignal;
}

export interface RequestContext {
  readonly runId?: string;
  readonly taskId?: string;
  readonly agentId: string;
  /** Distinguishes "generate a brief" from "repair a brief" in the fixture key. */
  readonly taskKind: string;
  /** Makes mock behaviour reproducible. */
  readonly seed: string;
}

export type ChatChunk =
  | { type: "text"; text: string }
  | { type: "tool-call"; call: ToolCallRequest }
  | { type: "done"; result: ChatResult };

export interface ChatResult {
  text: string;
  toolCalls: ToolCallRequest[];
  finishReason: "stop" | "length" | "tool-calls" | "content-filter";
  usage: { promptTokens: number; completionTokens: number };
  model: string;
  provider: ProviderId;
  /** True when this came from a degraded fallback rather than the primary. */
  degraded?: boolean;
}

export interface ProviderPricing {
  promptMicrosPerKTok: number;
  completionMicrosPerKTok: number;
}

export interface ProviderCapabilities {
  toolCalling: boolean;
  json: boolean;
  contextWindow: number;
  vision: boolean;
}

export interface ModelProvider {
  readonly id: ProviderId;
  chat(req: ChatRequest): AsyncIterable<ChatChunk>;
  /** Non-streaming convenience. Implemented over `chat` unless a provider does better. */
  complete(req: ChatRequest): Promise<ChatResult>;
  countTokens(text: string): number;
  readonly pricing: ProviderPricing;
  readonly capabilities: ProviderCapabilities;
  /** Resolves the tier to a concrete model id, or undefined if unmapped. */
  resolveModel(selector: ModelSelector): string | undefined;
}

export interface GenerateObjectOptions<T extends z.ZodTypeAny> {
  schema: T;
  request: ChatRequest;
  /** Attempts including the first. Default 3. */
  maxAttempts?: number;
  /** Names the shape in the prompt, which measurably improves compliance. */
  schemaName?: string;
  /** Receives validated-provider text as it arrives for durable UI streaming. */
  onToken?: (text: string) => Promise<void> | void;
}

/** Validated structured output plus the provider metadata needed by runtime. */
export interface GeneratedObject<T> {
  readonly data: T;
  readonly response: ChatResult;
}
