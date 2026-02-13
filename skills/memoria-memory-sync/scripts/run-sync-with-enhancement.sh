#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: bash skills/memoria-memory-sync/scripts/run-sync-with-enhancement.sh <session-json> [memoria-home]"
  echo "Optional env: MEMORIA_MCP_ENHANCE_CMD, LIBSQL_URL, LIBSQL_AUTH_TOKEN"
  exit 1
fi

SESSION_JSON="$1"
MEMORIA_HOME_OVERRIDE="${2:-$(pwd)}"

if [ ! -f "$SESSION_JSON" ]; then
  echo "Session JSON not found: $SESSION_JSON"
  exit 1
fi

echo "[memoria] init"
MEMORIA_HOME="$MEMORIA_HOME_OVERRIDE" ./cli init

echo "[memoria] sync"
MEMORIA_HOME="$MEMORIA_HOME_OVERRIDE" ./cli sync "$SESSION_JSON"

echo "[memoria] stats"
MEMORIA_HOME="$MEMORIA_HOME_OVERRIDE" ./cli stats

if [ -n "${LIBSQL_URL:-}" ] && [ -n "${MEMORIA_MCP_ENHANCE_CMD:-}" ]; then
  echo "[enhance] running MCP/libSQL enhancement command"
  eval "$MEMORIA_MCP_ENHANCE_CMD"
  echo "[enhance] completed"
else
  echo "[enhance] skipped (set LIBSQL_URL and MEMORIA_MCP_ENHANCE_CMD to enable)"
fi

echo "Hybrid memory workflow completed."
