# ADR 0005: Sandbox-first architecture

- Status: Accepted
- Date: 2026-08-01

## Context

The no-key path is a product requirement: development, tests, sales demos, and
pre-connection customer runs must work without reaching a real merchant account.
A mock that merely returns `ok` does not exercise the Run Theatre or contracts.

## Decision

An empty environment selects `MODEL_PROVIDER=mock`, appends mock as the final
fallback, enables sandbox outside production, and uses the embedded PostgreSQL
data directory. `KILN_SANDBOX=1` (or `SANDBOX_MODE=1`) forces every tool through
`simulate`, regardless of available credentials.

Every tool has the same input/output schema for live and simulated execution.
Simulation must be deterministic from the run seed, realistic enough to drive
downstream phases, and incapable of network or external spend. Synthetic model
output must validate fully or raise `SyntheticResponseFailure`; partial JSON is
never accepted.

PGlite supports single-process `db:push`, seed, tests, and exploration. Local
web + worker + MCP operation uses Docker PostgreSQL because the embedded data
directory has an exclusive writer lock. Redis and MinIO are part of that
production-shaped Compose environment.

## Live transition

A live provider is selected by setting `MODEL_PROVIDER`, providing its key and
model mapping, and disabling sandbox. Provider selection remains configuration,
not branching in agents. Connector live paths additionally require a healthy
credential, feature enablement, grants, approvals, and budget/authorisation.
Missing any condition routes to simulation or a typed refusal; it must not make
an opportunistic network call.

## Current limitations

The model synthesiser and tool simulations exist, but recorded model,
connector, and golden-run fixture directories are not yet populated to the
required acceptance level. The worker/MCP/bootstrap/demo orchestration and full
archetype run tests are separate implementation work. Until those pass, the
repository supports component sandbox tests, not the claimed 90-second complete
sales demo.
