# ADR 0002: Hand-written agent runtime

- Status: Accepted
- Date: 2026-08-01

## Context

KILN must reserve spend before execution, enforce per-agent tool grants,
survive approval waits, replay deterministically, and explain every state
transition. General agent frameworks obscure at least one of those boundaries
and make framework state compete with KILN's event log.

## Decision

KILN will not use LangChain, CrewAI, AutoGen, or another agent orchestration
framework. Agents are typed declarations. The runtime owns message assembly,
model selection, the tool loop, validation, critic/repair routing, artifact
writes, and event emission.

`run_events` is the source of truth. Current run state is a pure ordered fold;
phase and task tables are rebuildable projections. A durable job step appends an
event only after its idempotent work completes. Human waits are durable rows or
job-provider waits, never unresolved in-process promises.

All randomness derives from the run seed. Replay forces tools into sandbox mode
and compares the resulting artifacts rather than repeating external effects.

## Failure policy

Each phase declares retry, degrade, escalate, or abort. Retry has a cap, backoff,
and jitter. A malformed model result is a typed failure. A provider fallback is
recorded as degraded quality. Neither a catch-all retry nor silent continuation
is allowed.

## Consequences

The runtime has more KILN-owned code, but cost, permissions, and replay remain
inspectable. Changes to event semantics require versioning and replay tests.

The current runtime implements the event fold and an initial orchestrator, but
the production job driver, process-resumption suite, and full archetype golden
runs remain incomplete. Those gaps must not be represented as durable execution
until their integration tests pass.
