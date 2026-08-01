# ADR 0001: KILN stack

- Status: Accepted
- Date: 2026-08-01

## Context

KILN has long-running workflows, tenant data, audited side effects, live event
streams, and customer-facing surfaces. The stack must support strict contracts,
durable execution, and a useful zero-key development environment without
creating a second production architecture.

## Decision

KILN uses the following baseline:

- TypeScript 5.6 or newer on Node 22, with `strict` and
  `noUncheckedIndexedAccess` enabled.
- pnpm workspaces and Turborepo for the monorepo.
- Next.js 15 App Router, React 19, Tailwind CSS 4, and KILN-owned primitives
  composed over Radix.
- PostgreSQL 16, hosted by Supabase in production, with Drizzle schemas and
  generated migrations. Supabase Auth, Storage, and Realtime remain the hosted
  identity, object, and structural-event services.
- A hand-written runtime over an append-only event log. Inngest is the intended
  hosted job driver; a Postgres queue is the portable fallback.
- Zod 3 contracts at process and network boundaries.
- Stripe for KILN billing, Resend behind an email adapter, and OpenTelemetry for
  traces.
- Vitest for unit tests and PostgreSQL integration tests; Playwright for browser
  and visual tests.

PGlite is permitted only as a single-process local/test PostgreSQL runtime. It
does not replace PostgreSQL 16 in production. Docker Compose remains the
production-shaped local option for web, worker, and MCP processes running
together.

## Consequences

Packages must not substitute frameworks or persistence engines without a new
ADR. Shared JSON must be parsed with a contract rather than trusted by type
assertion. Provider SDKs and hosted services sit behind KILN interfaces so the
sandbox path remains usable.

The repository currently contains incomplete worker, billing, connector, and
mirror surfaces. This ADR records the target and constraints; it is not evidence
that every listed integration is already operational.
