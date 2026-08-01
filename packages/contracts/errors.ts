/**
 * Typed failures.
 *
 * CLAUDE.md §2.8: failure is a first-class state. Every one of these is a
 * condition the runtime knows how to route — to a retry, a degrade, a repair
 * agent, or a checkpoint. A bare `Error` thrown anywhere in KILN is a bug,
 * because it means some failure mode was never given a handling policy.
 */

export type KilnErrorCode =
  | "BUDGET_EXCEEDED"
  | "SCHEMA_VIOLATION"
  | "SYNTHETIC_RESPONSE_FAILURE"
  | "CREDENTIAL_UNAVAILABLE"
  | "UNAUTHORISED_SPEND"
  | "TOOL_NOT_PERMITTED"
  | "SCOPE_DENIED"
  | "EGRESS_BLOCKED"
  | "TOOL_TIMEOUT"
  | "PROVIDER_UNAVAILABLE"
  | "SLOP_LINT_FAILED"
  | "QUALITY_GATE_FAILED"
  | "CRITIC_REJECTED"
  | "COMPLIANCE_BLOCKED"
  | "LIVE_PUBLISH_BLOCKED"
  | "CONTEXT_OVERFLOW"
  | "IDEMPOTENCY_CONFLICT"
  | "INVARIANT_VIOLATED";

/** How the runtime should react. Chosen by the thrower, not guessed later. */
export type Disposition = "retry" | "degrade" | "escalate" | "abort";

export abstract class KilnError extends Error {
  abstract readonly code: KilnErrorCode;
  abstract readonly disposition: Disposition;
  /** Safe to show a customer? Internal detail stays out of the UI. */
  readonly customerFacing: boolean = false;

  constructor(
    message: string,
    readonly context: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }

  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      name: this.name,
      message: this.message,
      disposition: this.disposition,
      context: this.context,
    };
  }
}

/** Thrown *before* a spend, never after. See CLAUDE.md §7 and §9.3. */
export class BudgetExceeded extends KilnError {
  readonly code = "BUDGET_EXCEEDED" as const;
  readonly disposition = "escalate" as const;
  override readonly customerFacing = true;
  constructor(
    readonly category: string,
    readonly requestedMicros: number,
    readonly remainingMicros: number,
    context: Record<string, unknown> = {},
  ) {
    super(
      `Budget for "${category}" exhausted: needed ${requestedMicros} micros, ${remainingMicros} remain.`,
      { ...context, category, requestedMicros, remainingMicros },
    );
  }
}

/** Model output failed its Zod schema after the configured repair attempts. */
export class SchemaViolation extends KilnError {
  readonly code = "SCHEMA_VIOLATION" as const;
  readonly disposition = "retry" as const;
  constructor(
    readonly attempts: number,
    readonly issues: readonly { path: string; message: string }[],
    context: Record<string, unknown> = {},
  ) {
    super(`Model output failed validation after ${attempts} attempts.`, { ...context, issues });
  }
}

/**
 * The mock provider could not synthesise a schema-valid response.
 * Never swallowed, never partially satisfied — routed to the Repair agent,
 * which escalates to a checkpoint. See CLAUDE.md §7.
 */
export class SyntheticResponseFailure extends KilnError {
  readonly code = "SYNTHETIC_RESPONSE_FAILURE" as const;
  readonly disposition = "escalate" as const;
  constructor(
    readonly schemaPath: string,
    readonly reason: string,
    context: Record<string, unknown> = {},
  ) {
    super(`Cannot synthesise a valid response at schema path "${schemaPath}": ${reason}`, {
      ...context,
      schemaPath,
      reason,
    });
  }
}

/** A lease resolved to an expired/revoked secret. Run pauses to reconnect. */
export class CredentialUnavailable extends KilnError {
  readonly code = "CREDENTIAL_UNAVAILABLE" as const;
  readonly disposition = "escalate" as const;
  override readonly customerFacing = true;
  constructor(
    readonly provider: string,
    readonly assetId: string | undefined,
    readonly detail: string,
    context: Record<string, unknown> = {},
  ) {
    super(`No usable credential for ${provider}: ${detail}`, { ...context, provider, assetId });
  }
}

/** A spend tool ran without a matching, unexpired, sufficient authorisation. */
export class UnauthorisedSpend extends KilnError {
  readonly code = "UNAUTHORISED_SPEND" as const;
  readonly disposition = "escalate" as const;
  override readonly customerFacing = true;
  constructor(
    readonly toolId: string,
    readonly reason: "missing" | "expired" | "ceiling-exceeded" | "quote-mismatch",
    context: Record<string, unknown> = {},
  ) {
    super(`Refusing to spend via "${toolId}": authorisation ${reason}.`, { ...context, toolId, reason });
  }
}

/** Agent tried to call a tool outside its declared allowlist. */
export class ToolNotPermitted extends KilnError {
  readonly code = "TOOL_NOT_PERMITTED" as const;
  readonly disposition = "retry" as const;
  constructor(
    readonly agentId: string,
    readonly toolId: string,
  ) {
    super(`Agent "${agentId}" is not permitted to call "${toolId}".`, { agentId, toolId });
  }
}

export class ScopeDenied extends KilnError {
  readonly code = "SCOPE_DENIED" as const;
  readonly disposition = "escalate" as const;
  constructor(
    readonly toolId: string,
    readonly missing: readonly string[],
  ) {
    super(`Tool "${toolId}" requires ungranted scopes: ${missing.join(", ")}.`, { toolId, missing });
  }
}

/** Egress control refused a host, a private IP, or a redirect out of policy. */
export class EgressBlocked extends KilnError {
  readonly code = "EGRESS_BLOCKED" as const;
  readonly disposition = "degrade" as const;
  constructor(
    readonly url: string,
    readonly reason: string,
  ) {
    super(`Egress refused for ${url}: ${reason}`, { url, reason });
  }
}

export class ToolTimeout extends KilnError {
  readonly code = "TOOL_TIMEOUT" as const;
  readonly disposition = "retry" as const;
  constructor(
    readonly toolId: string,
    readonly timeoutMs: number,
  ) {
    super(`Tool "${toolId}" exceeded ${timeoutMs}ms.`, { toolId, timeoutMs });
  }
}

export class ProviderUnavailable extends KilnError {
  readonly code = "PROVIDER_UNAVAILABLE" as const;
  readonly disposition = "degrade" as const;
  constructor(
    readonly provider: string,
    readonly detail: string,
  ) {
    super(`Model provider "${provider}" unavailable: ${detail}`, { provider, detail });
  }
}

/** Deterministic copy lint still failed after every permitted repair cycle. */
export class SlopLintFailed extends KilnError {
  readonly code = "SLOP_LINT_FAILED" as const;
  readonly disposition = "escalate" as const;
  override readonly customerFacing = true;
  constructor(
    readonly artifactType: string,
    readonly cycles: number,
    readonly findings: readonly { rule: string; excerpt: string; instruction: string }[],
  ) {
    super(`Copy for ${artifactType} still failed the slop linter after ${cycles} repair cycles.`, {
      artifactType,
      cycles,
      findings,
    });
  }
}

/** Deterministic pre-launch gate failed. Never overridable by an agent. */
export class QualityGateFailed extends KilnError {
  readonly code = "QUALITY_GATE_FAILED" as const;
  readonly disposition = "escalate" as const;
  override readonly customerFacing = true;
  constructor(readonly failures: readonly { gate: string; assertion: string; detail: string }[]) {
    super(`${failures.length} quality gate(s) failed before launch.`, { failures });
  }
}

/** Critic rejected an artifact three times; escalate with the critique. */
export class CriticRejected extends KilnError {
  readonly code = "CRITIC_REJECTED" as const;
  readonly disposition = "escalate" as const;
  constructor(
    readonly artifactType: string,
    readonly cycles: number,
    readonly critique: unknown,
  ) {
    super(`Critic rejected ${artifactType} after ${cycles} repair cycles.`, { artifactType, cycles });
  }
}

/** Compliance Officer hard-blocked the run. Only a human can clear this. */
export class ComplianceBlocked extends KilnError {
  readonly code = "COMPLIANCE_BLOCKED" as const;
  readonly disposition = "abort" as const;
  override readonly customerFacing = true;
  constructor(
    readonly findings: readonly string[],
    context: Record<string, unknown> = {},
  ) {
    super(`Compliance blocked this build: ${findings.join("; ")}`, {
      ...context,
      findings,
      refundPath: {
        kind: "billing-review",
        href: "/billing?reason=compliance-block",
        policy: "The preflight runs before build work, so unused build credits remain available. Billing can review any exceptional charge.",
      },
    });
  }
}

/** Live publication is fail-closed until KYC and abuse review are clear. */
export class LivePublishBlocked extends KilnError {
  readonly code = "LIVE_PUBLISH_BLOCKED" as const;
  readonly disposition = "escalate" as const;
  override readonly customerFacing = true;
  constructor(readonly reason: "kyc-required" | "kyc-rejected" | "manual-review" | "account-unavailable") {
    const message = reason === "manual-review"
      ? "Live publication is paused while an operator reviews this business category."
      : reason === "kyc-rejected"
        ? "Live publication is unavailable because account verification was rejected."
        : reason === "kyc-required"
          ? "Verify the paying account before publishing anything live."
          : "The paying account could not be verified for live publication.";
    super(message, { reason, action: "/settings/verification" });
  }
}

export class ContextOverflow extends KilnError {
  readonly code = "CONTEXT_OVERFLOW" as const;
  readonly disposition = "degrade" as const;
  constructor(
    readonly agentId: string,
    readonly tokens: number,
    readonly budget: number,
  ) {
    super(`Context for "${agentId}" is ${tokens} tokens against a ${budget} budget.`, {
      agentId,
      tokens,
      budget,
    });
  }
}

export class IdempotencyConflict extends KilnError {
  readonly code = "IDEMPOTENCY_CONFLICT" as const;
  readonly disposition = "abort" as const;
  constructor(readonly key: string) {
    super(`Idempotency key "${key}" is already in flight with a different input.`, { key });
  }
}

/** Something the code believed impossible. Always a bug; never retried. */
export class InvariantViolated extends KilnError {
  readonly code = "INVARIANT_VIOLATED" as const;
  readonly disposition = "abort" as const;
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(`Invariant violated: ${message}`, context);
  }
}

export function isKilnError(e: unknown): e is KilnError {
  return e instanceof KilnError;
}

export function dispositionOf(e: unknown): Disposition {
  return isKilnError(e) ? e.disposition : "retry";
}
