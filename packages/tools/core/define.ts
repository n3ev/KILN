import type { Scope } from "@kiln/contracts";
import type { z } from "zod";

/**
 * Tool definition — CLAUDE.md §9.1.
 *
 * A tool is the only way anything in KILN touches the outside world. Agents
 * emit tool calls; they never open a socket, read a file, or write a row.
 *
 * `simulate` is **mandatory**. It is not a debugging affordance: it is how the
 * product runs before partner accounts exist, how the test suite runs, and how
 * a demo run works for a prospect. A tool without a credible simulation is a
 * tool that cannot be demoed, tested, or replayed.
 */

export type SideEffect = "none" | "read" | "write" | "spend" | "publish" | "destructive";

export interface RetryPolicy {
  readonly attempts: number;
  readonly backoffMs: number;
  /** Errors matching this are retried; everything else fails immediately. */
  readonly retryOn?: RegExp;
}

export const DEFAULT_RETRY: RetryPolicy = {
  attempts: 3,
  backoffMs: 400,
  retryOn: /HTTP (429|5\d\d)|ETIMEDOUT|ECONNRESET|fetch failed/i,
};

export interface ToolContext {
  readonly runId: string;
  readonly ventureId: string;
  readonly accountId: string;
  readonly taskId?: string;
  readonly agentId: string;
  /** Deterministic per (run, tool, call index) so simulations are replayable. */
  readonly seed: string;
  readonly sandbox: boolean;
  readonly grantedScopes: readonly Scope[];
  /**
   * Set for a side-effect call made immediately after ingesting web content.
   * It forces a fresh human confirmation even when autonomy would cover it.
   */
  readonly untrustedContentIngested?: boolean;
  /** Resolves a credential handle at request time. Never returns a raw secret. */
  readonly lease: (assetKind: string, scopes: readonly string[]) => Promise<CredentialHandle>;
  /** Egress-controlled HTTP client. Direct `fetch` is banned inside tools. */
  readonly http: EgressClient;
  readonly logger: {
    debug(msg: string, fields?: Record<string, unknown>): void;
    info(msg: string, fields?: Record<string, unknown>): void;
    warn(msg: string, fields?: Record<string, unknown>): void;
  };
  readonly signal?: AbortSignal;
}

/** An opaque reference to a credential. The plaintext never crosses this line. */
export interface CredentialHandle {
  readonly id: string;
  readonly provider: string;
  readonly expiresAt: string;
}

export interface EgressClient {
  fetch(url: string, init?: RequestInit & { handle?: CredentialHandle }): Promise<Response>;
}

export interface ToolSpec<I extends z.ZodTypeAny, O extends z.ZodTypeAny> {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  /**
   * Model-facing prose. Write it properly: what the tool does, what it does
   * *not* do, what a valid input looks like, and what each failure means. Bad
   * tool descriptions are the single most common cause of agent flailing.
   */
  readonly description: string;
  readonly scopes: readonly Scope[];
  readonly sideEffect: SideEffect;
  readonly input: I;
  readonly output: O;
  /** Which run envelope pays for this call. Defaults to external for spend
   * tools and tool for everything else. Image generation opts into image. */
  readonly budgetCategory?: "image" | "tool" | "external";
  readonly costEstimate?: (input: z.infer<I>) => number;
  readonly idempotent: boolean;
  /** Input paths excluded from the idempotency key (timestamps, nonces). */
  readonly idempotencyIgnore?: readonly string[];
  readonly timeoutMs: number;
  readonly retry?: RetryPolicy;
  readonly execute: (input: z.infer<I>, ctx: ToolContext) => Promise<z.infer<O>>;
  /** Realistic, schema-valid, seed-deterministic. No network. Mandatory. */
  readonly simulate: (input: z.infer<I>, ctx: ToolContext) => Promise<z.infer<O>>;
}

export interface Tool<I extends z.ZodTypeAny = z.ZodTypeAny, O extends z.ZodTypeAny = z.ZodTypeAny>
  extends ToolSpec<I, O> {
  readonly retry: RetryPolicy;
  readonly idempotencyIgnore: readonly string[];
  readonly budgetCategory: "image" | "tool" | "external";
}

/**
 * A tool with its generics erased, for storage and iteration.
 *
 * `Tool<I, O>` is invariant in `I`: because `I` appears both as a property
 * (`input: I`) and in the parameter position of `execute`, a
 * `Tool<ZodObject<...>>` is NOT assignable to `Tool<ZodTypeAny>`. That makes
 * `Tool[]` useless as a collection type.
 *
 * `never` in the parameter position is what fixes it — it is the bottom type,
 * so every concrete handler is assignable — and `unknown` in the return
 * position keeps the result honest. Callers narrow through the tool's own Zod
 * schemas, which is where validation belongs anyway.
 */
export type AnyTool = Omit<Tool<z.ZodTypeAny, z.ZodTypeAny>, "execute" | "simulate" | "costEstimate"> & {
  readonly costEstimate?: (input: never) => number;
  readonly execute: (input: never, ctx: ToolContext) => Promise<unknown>;
  readonly simulate: (input: never, ctx: ToolContext) => Promise<unknown>;
};

export function defineTool<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(spec: ToolSpec<I, O>): Tool<I, O> {
  if (!spec.id.includes(".")) {
    throw new Error(`Tool id "${spec.id}" must be namespaced, e.g. "shopify.product.upsert".`);
  }
  if (spec.description.trim().length < 40) {
    // Enforced rather than requested. A one-line description is how you get an
    // agent that calls the wrong tool and then argues about it for six turns.
    throw new Error(`Tool "${spec.id}" needs a real description for the model, not a label.`);
  }
  if (spec.sideEffect === "spend" && spec.costEstimate === undefined) {
    throw new Error(`Tool "${spec.id}" spends money and must declare costEstimate.`);
  }

  return {
    ...spec,
    retry: spec.retry ?? DEFAULT_RETRY,
    idempotencyIgnore: spec.idempotencyIgnore ?? [],
    budgetCategory: spec.budgetCategory ?? (spec.sideEffect === "spend" ? "external" : "tool"),
  };
}

/** Side effects that require an approval checkpoint unless autonomy covers it. */
export const APPROVAL_REQUIRED: readonly SideEffect[] = ["spend", "publish", "destructive"];

export function needsApproval(effect: SideEffect): boolean {
  return APPROVAL_REQUIRED.includes(effect);
}

/** Read-only tools are the only ones exposed over MCP in prompt 1. */
export function isReadOnly(effect: SideEffect): boolean {
  return effect === "none" || effect === "read";
}
