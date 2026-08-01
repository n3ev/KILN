#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a
  source .env
  set +a
fi

# Embedded PGlite holds one process lock. With DATABASE_URL set, use the full
# production-shaped process topology; otherwise the web owns the embedded DB.
if [[ -n "${DATABASE_URL:-}" ]]; then
  exec pnpm --parallel --stream \
    --filter @kiln/web --filter @kiln/worker --filter @kiln/mcp run dev
fi

echo "No DATABASE_URL: starting the web process alone against embedded PGlite." >&2
echo "Runs created from intake will queue with no worker to execute them." >&2
exec pnpm --filter @kiln/web dev
