/**
 * @kiln/quality — the three independent bars a build must clear.
 *
 * They are separate on purpose (CLAUDE.md §8.2):
 *
 *   slop-lint  deterministic, per-piece-of-copy, blocks before an artifact is
 *              written, three repair cycles then escalates
 *   rubrics    model judgement, per artifact, the Critic rejects and instructs
 *   gates      deterministic, per run, blocks `launch`, never agent-overridable
 *
 * Conflating any two of them produces a system that either ships slop or never
 * ships at all.
 */

export * from "./slop-lint/index.js";
export * from "./rubrics/index.js";
export * from "./gates/index.js";
