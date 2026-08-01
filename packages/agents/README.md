# @kiln/agents

Agent definitions are **pure declarations** — no agent executes anything. The
runtime owns the loop (see `packages/runtime/orchestrator.ts`).

## Layout

`roster.ts` and `delivery-operations.ts` are the single source of truth for the
fourteen pure declarations. Each named agent directory is a typed facade with:

- `agent.ts` — the declaration under both its role name and `agent`
- `prompt.ts` — the role's composed prompt function
- `schemas.ts` — concrete input/output Zod schemas and inferred types
- `rubric.ts` — the resolved Critic rubric, when the role uses one
- `__tests__/` — a focused module-contract test

This keeps shared policy in one place while making every role independently
importable, for example `@kiln/agents/analyst`.

Output schemas live in `@kiln/contracts` because artifacts are the shared
currency between agents; rubrics live in `@kiln/quality/rubrics` because the
Critic scores against them and the quality package owns judgement.
