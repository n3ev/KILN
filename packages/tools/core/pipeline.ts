import { randomUUID } from "node:crypto";
import type { Scope, SpendAuthorisation } from "@kiln/contracts";
import {
  IdempotencyConflict,
  ScopeDenied,
  ToolNotPermitted,
  ToolTimeout,
  UnauthorisedSpend,
  missingScopes,
} from "@kiln/contracts";
import { logger, withSpan } from "@kiln/observability";
import { idempotencyKey } from "./canonical.js";
import { needsApproval, type AnyTool, type ToolContext } from "./define.js";
import type { ToolRegistry } from "./registry.js";

/**
 * The tool invocation pipeline — CLAUDE.md §9.2.
 *
 * Ten steps, in this order. The order is load-bearing: budget is reserved
 * before execution so an overrun cannot happen, idempotency is checked before
 * execution so a replay cannot double-charge, and approval is intercepted
 * before either so a human sees the request before money moves.
 *
 *   1 allowlist → 2 grants → 3 input schema → 4 sandbox routing →
 *   5 approval → 6 budget reservation → 7 idempotency → 8 egress (in ctx) →
 *   9 execute with timeout+retry → 10 validate output, persist, emit event
 */

export interface ToolCallRecord {
  readonly id: string;
  readonly toolId: string;
  readonly toolVersion: string;
  readonly idempotencyKey: string;
  readonly input: unknown;
  readonly output: unknown;
  readonly status: "succeeded" | "failed" | "refused";
  readonly latencyMs: number;
  readonly externalCostMicros: number;
  readonly sandboxed: boolean;
}

/** Everything the pipeline needs from the run, injected rather than imported. */
export interface PipelineDeps {
  readonly registry: ToolRegistry;
  /** Tools the *calling agent* declared. Step 1. */
  readonly agentAllowlist: readonly string[];
  readonly grantedScopes: readonly Scope[];
  /** Returns a completed call for this key, if one exists. Step 7. */
  readonly findCompleted: (key: string) => Promise<ToolCallRecord | undefined>;
  readonly persist: (record: ToolCallRecord) => Promise<void>;
  readonly emit: (event: { type: string; payload: Record<string, unknown> }) => Promise<void>;
  /** Blocks until a human decides. Step 5. */
  readonly requestApproval: (args: {
    toolId: string;
    input: unknown;
    sideEffect: string;
    estimatedMicros: number;
    reason: "side_effect" | "untrusted_content";
  }) => Promise<{ approved: boolean; reason?: string }>;
  /** True when autonomy or a standing authorisation covers this side effect. */
  readonly approvalCoveredByAutonomy: (sideEffect: string) => boolean;
  /** Step 6. Throws BudgetExceeded before anything is spent. */
  readonly budget: {
    reserve: (category: "image" | "tool" | "external", micros: number, ref: string) => Promise<void>;
    settle: (ref: string, actualMicros: number) => Promise<void>;
    release: (ref: string) => Promise<void>;
  };
  /** Resolves the authorisation a `spend` tool must present. */
  readonly findAuthorisation: (authorisationId: string) => Promise<SpendAuthorisation | undefined>;
  /** Atomically marks a one-shot authorisation as consumed. */
  readonly consumeAuthorisation: (authorisationId: string, toolCallId: string) => Promise<void>;
}

export interface InvokeArgs {
  readonly toolId: string;
  readonly input: unknown;
  readonly ctx: ToolContext;
  /** Required for tools with sideEffect: 'spend'. */
  readonly authorisationId?: string;
}

export async function invokeTool(deps: PipelineDeps, args: InvokeArgs): Promise<unknown> {
  const { toolId, input, ctx } = args;
  const started = Date.now();

  // ── 1. Allowlist ──────────────────────────────────────────────────────────
  if (!deps.agentAllowlist.includes(toolId)) {
    throw new ToolNotPermitted(ctx.agentId, toolId);
  }

  const tool: AnyTool = deps.registry.require(toolId);

  // ── 2. Grants ─────────────────────────────────────────────────────────────
  const missing = missingScopes(deps.grantedScopes, tool.scopes);
  if (missing.length > 0) throw new ScopeDenied(toolId, missing);

  // ── 3. Input validation ───────────────────────────────────────────────────
  const parsedInput = tool.input.safeParse(input);
  if (!parsedInput.success) {
    // Returned to the agent as a correctable error, not thrown as a crash.
    throw new Error(
      `Invalid input for "${toolId}": ${parsedInput.error.issues
        .map((i) => `${i.path.join(".") || "(root)"} ${i.message}`)
        .join("; ")}`,
    );
  }
  const validInput = parsedInput.data as never;

  // ── 4. Sandbox routing ────────────────────────────────────────────────────
  const sandboxed = ctx.sandbox;

  // ── 5. Approval interception ──────────────────────────────────────────────
  const estimate = tool.costEstimate?.(validInput) ?? 0;

  const followsUntrustedContent = ctx.untrustedContentIngested === true && needsApproval(tool.sideEffect);
  if (
    needsApproval(tool.sideEffect) &&
    (followsUntrustedContent || !deps.approvalCoveredByAutonomy(tool.sideEffect))
  ) {
    const decision = await deps.requestApproval({
      toolId,
      input: validInput,
      sideEffect: tool.sideEffect,
      estimatedMicros: estimate,
      reason: followsUntrustedContent ? "untrusted_content" : "side_effect",
    });
    if (!decision.approved) {
      const record: ToolCallRecord = {
        id: randomUUID(),
        toolId,
        toolVersion: tool.version,
        idempotencyKey: idempotencyKey({
          runId: ctx.runId,
          toolId,
          toolVersion: tool.version,
          input: validInput,
          ignore: tool.idempotencyIgnore,
        }),
        input: validInput,
        output: null,
        status: "refused",
        latencyMs: Date.now() - started,
        externalCostMicros: 0,
        sandboxed,
      };
      await deps.persist(record);
      await deps.emit({ type: "tool.failed", payload: { toolCallId: record.id, error: { reason: decision.reason ?? "refused by operator" } } });
      throw new UnauthorisedSpend(toolId, "missing", { reason: decision.reason });
    }
  }

  // Spend tools accept only an authorisation id, and it must still be valid.
  const authorisation =
    tool.sideEffect === "spend"
      ? await assertSpendAuthorised(deps, tool, args, estimate)
      : undefined;

  const key = idempotencyKey({
    runId: ctx.runId,
    toolId,
    toolVersion: tool.version,
    input: validInput,
    ignore: tool.idempotencyIgnore,
  });

  // ── 7. Idempotency ────────────────────────────────────────────────────────
  const previous = await deps.findCompleted(key);
  if (previous) {
    if (previous.status === "succeeded") {
      logger.debug("replaying completed tool call", { toolId, idempotencyKey: key });
      return previous.output;
    }
    if (previous.status === "refused") {
      throw new IdempotencyConflict(key);
    }
  }

  // ── 6. Budget reservation ─────────────────────────────────────────────────
  const category = tool.budgetCategory;
  const ref = `${key}:${started}`;
  const reservedMicros = authorisation?.ceilingMicros ?? estimate;
  if (reservedMicros > 0) await deps.budget.reserve(category, reservedMicros, ref);

  await deps.emit({
    type: "tool.called",
    payload: { toolCallId: key, toolId, sandboxed, input: validInput },
  });

  // ── 9. Execute ────────────────────────────────────────────────────────────
  try {
    const raw = await withSpan(
      `tool:${toolId}`,
      () => runWithRetries(tool, validInput, ctx, sandboxed),
      undefined,
      { toolId, sandboxed, agentId: ctx.agentId },
    );

    // ── 10. Output validation and persistence ───────────────────────────────
    const parsedOutput = tool.output.safeParse(raw);
    if (!parsedOutput.success) {
      throw new Error(
        `Tool "${toolId}" returned output that violates its own contract: ${parsedOutput.error.issues
          .map((i) => `${i.path.join(".") || "(root)"} ${i.message}`)
          .join("; ")}`,
      );
    }

    const latencyMs = Date.now() - started;
    const reportedCost = paidMicrosOf(parsedOutput.data);
    if (authorisation && reportedCost !== undefined && reportedCost > authorisation.ceilingMicros) {
      throw new UnauthorisedSpend(toolId, "ceiling-exceeded", {
        authorisationId: authorisation.id,
        actualMicros: reportedCost,
        ceilingMicros: authorisation.ceilingMicros,
      });
    }
    const actualCost = sandboxed ? 0 : (reportedCost ?? estimate);
    if (reservedMicros > 0) await deps.budget.settle(ref, actualCost);

    const record: ToolCallRecord = {
      id: randomUUID(),
      toolId,
      toolVersion: tool.version,
      idempotencyKey: key,
      input: validInput,
      output: parsedOutput.data,
      status: "succeeded",
      latencyMs,
      externalCostMicros: actualCost,
      sandboxed,
    };
    await deps.persist(record);
    if (authorisation && !authorisation.standing) {
      await deps.consumeAuthorisation(authorisation.id, record.id);
    }
    await deps.emit({ type: "tool.succeeded", payload: { toolCallId: key, latencyMs, costMicros: actualCost } });

    return parsedOutput.data;
  } catch (error) {
    if (reservedMicros > 0) await deps.budget.release(ref);

    await deps.persist({
      id: randomUUID(),
      toolId,
      toolVersion: tool.version,
      idempotencyKey: key,
      input: validInput,
      output: null,
      status: "failed",
      latencyMs: Date.now() - started,
      externalCostMicros: 0,
      sandboxed,
    });
    await deps.emit({ type: "tool.failed", payload: { toolCallId: key, error: { message: String(error) } } });
    throw error;
  }
}

/**
 * Two-phase spend — CLAUDE.md §9.3.
 *
 * The commit tool accepts only an authorisation id and refuses if the actual
 * price exceeds the ceiling, if the authorisation has expired, or if the quote
 * id does not match. All three are checked here so no individual tool can
 * forget one.
 */
async function assertSpendAuthorised(
  deps: PipelineDeps,
  tool: AnyTool,
  args: InvokeArgs,
  estimate: number,
): Promise<SpendAuthorisation> {
  if (!args.authorisationId) throw new UnauthorisedSpend(tool.id, "missing");

  const auth = await deps.findAuthorisation(args.authorisationId);
  if (!auth) throw new UnauthorisedSpend(tool.id, "missing", { authorisationId: args.authorisationId });

  if (auth.runId !== args.ctx.runId) {
    throw new UnauthorisedSpend(tool.id, "missing", {
      authorisationId: auth.id,
      reason: "authorisation belongs to a different run",
    });
  }
  if (auth.category !== "external") {
    throw new UnauthorisedSpend(tool.id, "missing", {
      authorisationId: auth.id,
      reason: `expected external authorisation, received ${auth.category}`,
    });
  }
  if (auth.consumedByToolCallId && !auth.standing) {
    throw new UnauthorisedSpend(tool.id, "missing", {
      authorisationId: auth.id,
      reason: "authorisation was already consumed",
      consumedByToolCallId: auth.consumedByToolCallId,
    });
  }

  if (new Date(auth.expiresAt).getTime() < Date.now()) {
    throw new UnauthorisedSpend(tool.id, "expired", { authorisationId: auth.id, expiresAt: auth.expiresAt });
  }
  if (estimate > auth.ceilingMicros) {
    throw new UnauthorisedSpend(tool.id, "ceiling-exceeded", {
      authorisationId: auth.id,
      estimate,
      ceilingMicros: auth.ceilingMicros,
    });
  }

  const quoteId = (args.input as { quoteId?: string } | null)?.quoteId;
  if (quoteId !== undefined && quoteId !== auth.quoteId) {
    throw new UnauthorisedSpend(tool.id, "quote-mismatch", {
      authorisationId: auth.id,
      expected: auth.quoteId,
      received: quoteId,
    });
  }

  const inputCurrency = (args.input as { currency?: string } | null)?.currency;
  if (inputCurrency !== undefined && inputCurrency !== auth.currency) {
    throw new UnauthorisedSpend(tool.id, "quote-mismatch", {
      authorisationId: auth.id,
      expectedCurrency: auth.currency,
      receivedCurrency: inputCurrency,
    });
  }

  return auth;
}

async function runWithRetries(
  tool: AnyTool,
  input: never,
  ctx: ToolContext,
  sandboxed: boolean,
): Promise<unknown> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= tool.retry.attempts; attempt++) {
    try {
      return await runAttemptWithTimeout(tool, input, ctx, sandboxed);
    } catch (error) {
      lastError = error;
      const retryable = tool.retry.retryOn?.test(String(error)) ?? false;
      if (!retryable || attempt === tool.retry.attempts) throw error;
      const delay = tool.retry.backoffMs * 2 ** (attempt - 1) * (0.5 + Math.random() / 2);
      logger.debug("retrying tool call", { toolId: tool.id, attempt, delayMs: Math.round(delay) });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

function runAttemptWithTimeout(
  tool: AnyTool,
  input: never,
  ctx: ToolContext,
  sandboxed: boolean,
): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const controller = new AbortController();
    const onParentAbort = () => controller.abort(ctx.signal?.reason);
    ctx.signal?.addEventListener("abort", onParentAbort, { once: true });
    const timer = setTimeout(() => {
      controller.abort(new ToolTimeout(tool.id, tool.timeoutMs));
      reject(new ToolTimeout(tool.id, tool.timeoutMs));
    }, tool.timeoutMs);
    const attemptContext: ToolContext = { ...ctx, signal: controller.signal };
    const promise = sandboxed
      ? tool.simulate(input, attemptContext)
      : tool.execute(input, attemptContext);
    promise.then(
      (v) => {
        clearTimeout(timer);
        ctx.signal?.removeEventListener("abort", onParentAbort);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        ctx.signal?.removeEventListener("abort", onParentAbort);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

function paidMicrosOf(output: unknown): number | undefined {
  if (output === null || typeof output !== "object") return undefined;
  const value = (output as Record<string, unknown>)["paidMicros"];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}
