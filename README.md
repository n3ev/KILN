# KILN

Takes a one-sentence business idea and stands up a real, operating business
around it — sourcing, storefront, brand, content, compliance, launch, and the
ongoing operator loop — using a fleet of specialised agents with typed,
permissioned tools.

## Run it

Requires Node 22 (`nvm use`) and pnpm 9.

```bash
corepack pnpm bootstrap   # Docker topology, migrations, seed, web, worker, and MCP
```

On a fresh Node 22 machine, `bash scripts/bootstrap.sh` also works before a
global pnpm shim exists; it resolves the pinned package manager through Corepack.

Without Docker, the same command falls back to the embedded Postgres web app.
For the sales/build smoke, run `pnpm demo:run`; it creates a complete physical
venture, persists the live theatre stream, and verifies all artifacts and gates.

**No API keys are required, and none are optional-but-really-needed.** With an
empty environment KILN boots the schema-driven `mock` model provider (using a
recorded fixture when one exists), routes every connector to its simulated twin, and
runs an embedded Postgres. The Run Theatre streams a complete build.

## Layout

| Path | What lives there |
|---|---|
| `apps/web` | Next.js 15 — marketing, customer app, operator console |
| `apps/worker` | Durable job functions, sync crons |
| `apps/mcp` | MCP server exposing the tool catalogue (sandbox, read-only) |
| `packages/contracts` | Every Zod schema. The single source of truth for types |
| `packages/db` | Drizzle schema, RLS policies, migrations, seed |
| `packages/model-gateway` | `kimi` / `deepseek` / `mock` providers behind one interface |
| `packages/runtime` | Event-log state machine, orchestrator, replay |
| `packages/agents` | The agent roster: prompts, schemas, rubrics |
| `packages/tools` | The capability catalogue — every side effect in the product |
| `packages/playbooks` | Business archetypes |
| `packages/quality` | Slop linter, rubrics, quality gates |
| `packages/design-engine` | Per-brand token generation, layout archetypes |
| `packages/vault` | Envelope encryption, scoped credential leases |
| `packages/mirror` | Metric ingestion and normalisation |

## The rules that matter

Read `docs/agent-authoring.md` before adding an agent, and the quality package's
slop-lint rules before writing anything that generates customer-facing
prose. The short version:

- Every side effect is a tool call. Agents never touch the network directly.
- Untrusted fetched content is data, never instruction.
- Money is accounted for **before** it is spent, in integer micros.
- A run is a fold over an append-only event log, and is replayable.
- Generated copy passes a deterministic linter before it can become an artifact.

## Testing

```bash
pnpm test          # unit + integration (Vitest)
pnpm test:e2e      # Playwright
pnpm demo:run      # full persisted sandbox build and sales smoke
pnpm run:replay -- <runId> # isolated mock replay; exits nonzero on artifact drift
```
