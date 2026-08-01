#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# The e2e topology.
#
# Two specs — the intake-created run reaching `live`, and the mid-run theatre
# reload — need a worker executing beside the web app, which needs both on one
# database. Embedded PGlite cannot do that: it takes an exclusive lock on its
# data directory, so a second process cannot open it. Those two specs were
# `test.fixme`d for exactly this reason.
#
# So: use Postgres when there is one. DATABASE_URL wins, then docker-compose.
# Failing both, fall back to the old web-only arrangement and tell the specs,
# through KILN_E2E_WORKER, that there is no worker — they skip with a reason
# rather than failing for a missing service. CI has Docker, so CI runs them.

export MODEL_PROVIDER=mock
export KILN_SANDBOX=1
export APP_URL=http://127.0.0.1:3101
export NEXT_PUBLIC_APP_URL=http://127.0.0.1:3101
export KILN_PGDATA="$PWD/.kiln/e2e-pgdata"

if [[ "${KILN_E2E_WORKER:-0}" != "1" ]]; then
  echo "e2e: no DATABASE_URL and no Docker; running the web app alone against" >&2
  echo "e2e: embedded PGlite. The two worker-driven specs will skip." >&2
elif [[ -n "${DATABASE_URL:-}" ]]; then
  echo "e2e: using the supplied DATABASE_URL." >&2
else
  echo "e2e: starting the docker-compose Postgres." >&2
  docker compose up -d postgres
  for _attempt in $(seq 1 30); do
    if docker compose exec -T postgres pg_isready -U kiln -d kiln >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done
  if ! docker compose exec -T postgres pg_isready -U kiln -d kiln >/dev/null 2>&1; then
    echo "e2e: Postgres did not become ready within 60 seconds." >&2
    exit 1
  fi
  export DATABASE_URL="postgresql://kiln:kiln@127.0.0.1:5432/kiln"
fi

export MOCK_STREAM_JITTER_MS=0
pnpm db:reset
pnpm db:push
pnpm seed

if [[ -n "${DATABASE_URL:-}" ]]; then
  # Two workers, because three specs each start a run and one worker claims one
  # job at a time — the third would spend its whole timeout queued behind the
  # first. The queue claims `FOR UPDATE SKIP LOCKED`, so this is the shape it
  # was built for rather than a test-only trick.
  #
  # A 1ms per-chunk stream delay keeps a run in flight for tens of seconds
  # instead of a handful, which is the window the mid-run reload spec needs.
  # That spec asserts the run is still going when it snapshots, so if this ever
  # stops being enough it fails rather than quietly proving nothing.
  for _worker in 1 2; do
    MOCK_STREAM_JITTER_MS="${KILN_E2E_WORKER_JITTER_MS:-1}" \
      WORKER_POLL_MS=250 \
      pnpm --filter @kiln/worker start &
  done
fi

# Playwright owns this process and kills its process group on teardown, which
# is what stops the worker.
exec pnpm --filter @kiln/web exec next dev -p 3101
