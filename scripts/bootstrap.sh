#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if command -v pnpm >/dev/null 2>&1; then
  pnpm_cmd=(pnpm)
elif command -v corepack >/dev/null 2>&1; then
  # A fresh Node 22 install includes Corepack even when the pnpm shim has not
  # been enabled globally. packageManager in package.json pins the version.
  pnpm_cmd=(corepack pnpm)
else
  echo "KILN needs Node 22 with Corepack (or pnpm 9.15.4)." >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
fi

# shellcheck disable=SC1091 -- the operator-owned file is deliberately local.
set -a
source .env
set +a

"${pnpm_cmd[@]}" install --frozen-lockfile

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker compose up -d postgres redis minio
  BOOTSTRAP_DATABASE_URL="${DATABASE_URL:-postgresql://kiln:kiln@127.0.0.1:5432/kiln}"
  export DATABASE_URL="$BOOTSTRAP_DATABASE_URL"

  ready=0
  for _attempt in $(seq 1 30); do
    if docker compose exec -T postgres pg_isready -U kiln -d kiln >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 2
  done
  if [[ "$ready" != "1" ]]; then
    echo "Postgres did not become ready within 60 seconds." >&2
    exit 1
  fi
  services="web + worker + MCP"
elif [[ -n "${DATABASE_URL:-}" ]]; then
  # An operator-supplied Postgres (Supabase, a managed instance, a local
  # install) is the same production-shaped topology as docker-compose, minus
  # Redis and MinIO. Prompt-1 uses neither: the job queue is Postgres-backed.
  echo "Docker is unavailable, but DATABASE_URL is set; using it." >&2
  echo "Redis and MinIO are not started." >&2
  services="web + worker + MCP"
elif [[ "${KILN_ALLOW_EMBEDDED:-0}" == "1" ]]; then
  # Embedded PGlite takes an exclusive lock on its data directory, so exactly
  # one process can hold it. That is a web-only environment, and the operator
  # has now said in as many words that it is what they want.
  echo "Docker is unavailable; KILN_ALLOW_EMBEDDED=1, so using embedded Postgres." >&2
  echo "This starts the web process only: PGlite admits one process, so no" >&2
  echo "worker and no MCP server, and no Redis or MinIO. A run created from" >&2
  echo "intake will sit in the queue with nothing to execute it." >&2
  unset DATABASE_URL
  services="web only (embedded fallback)"
else
  echo "Docker is not available, so KILN cannot start Postgres, Redis, and MinIO." >&2
  echo "Install and start Docker, then re-run \`pnpm bootstrap\`. Pointing" >&2
  echo "DATABASE_URL at any Postgres 16+ works too." >&2
  echo >&2
  echo "To develop against the embedded database instead, re-run with" >&2
  echo "KILN_ALLOW_EMBEDDED=1 — but read what that costs first: PGlite admits" >&2
  echo "one process, so you get the web app alone, with no worker to execute" >&2
  echo "runs. Bootstrap fails here rather than exiting 0, because an" >&2
  echo "unattended run that reports success while delivering half a stack is" >&2
  echo "worse than one that fails." >&2
  exit 1
fi

export MODEL_PROVIDER="${MODEL_PROVIDER:-mock}"
export KILN_SANDBOX="${KILN_SANDBOX:-1}"
export DEMO_MODE="${DEMO_MODE:-1}"

"${pnpm_cmd[@]}" db:push
"${pnpm_cmd[@]}" seed

printf '\n%-18s %s\n' "KILN web" "http://localhost:3000"
printf '%-18s %s\n' "MCP health" "http://localhost:3100/health"
printf '%-18s %s\n' "MinIO console" "http://localhost:9001"
printf '%-18s %s\n' "Demo login" "demo@kiln.local (offline, no password)"
printf '%-18s %s\n\n' "Starting" "$services"

if [[ "${KILN_BOOTSTRAP_NO_START:-0}" == "1" ]]; then
  exit 0
fi

if [[ -n "${DATABASE_URL:-}" ]]; then
  exec "${pnpm_cmd[@]}" --parallel --stream \
    --filter @kiln/web --filter @kiln/worker --filter @kiln/mcp run dev
fi
exec "${pnpm_cmd[@]}" --filter @kiln/web dev
