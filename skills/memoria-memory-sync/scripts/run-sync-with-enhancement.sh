#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: bash skills/memoria-memory-sync/scripts/run-sync-with-enhancement.sh <session-json> [memoria-home]"
  echo "Optional env: MEMORIA_MCP_ENHANCE_CMD, LIBSQL_URL, LIBSQL_AUTH_TOKEN, MEMORIA_MCP_STRICT"
  exit 1
fi

SESSION_JSON="$1"
MEMORIA_HOME_OVERRIDE="${2:-$(pwd)}"
MCP_STRICT="${MEMORIA_MCP_STRICT:-1}"

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

if [ -n "${LIBSQL_URL:-}" ]; then
  echo "[enhance] building MCP bridge payload"
  MCP_PAYLOAD_PATH="$(node skills/memoria-memory-sync/scripts/build-mcp-bridge-payload.mjs --memoria-home "$MEMORIA_HOME_OVERRIDE")"
  export MEMORIA_MCP_PAYLOAD="$MCP_PAYLOAD_PATH"
  echo "[enhance] payload: $MEMORIA_MCP_PAYLOAD"

  MCP_REQUESTS_PATH="$(node skills/memoria-memory-sync/scripts/build-mcp-tool-requests.mjs --payload "$MEMORIA_MCP_PAYLOAD")"
  export MEMORIA_MCP_REQUESTS="$MCP_REQUESTS_PATH"
  echo "[enhance] tool requests: $MEMORIA_MCP_REQUESTS"

  if [ -n "${MEMORIA_MCP_ENHANCE_CMD:-}" ]; then
    echo "[enhance] running MCP/libSQL enhancement command"
    if eval "$MEMORIA_MCP_ENHANCE_CMD"; then
      echo "[enhance] completed"
    elif [ "$MCP_STRICT" = "1" ]; then
      echo "[enhance] failed (strict mode), exiting"
      exit 1
    else
      echo "[enhance] failed but continuing (MEMORIA_MCP_STRICT=0)"
    fi
  else
    echo "[enhance] command not set; using built-in MCP ingest"
    if node skills/memoria-memory-sync/scripts/ingest-mcp-libsql.mjs --requests "$MEMORIA_MCP_REQUESTS"; then
      echo "[enhance] completed with built-in MCP ingest"
    elif [ "$MCP_STRICT" = "1" ]; then
      echo "[enhance] ingest failed (strict mode), exiting"
      exit 1
    else
      echo "[enhance] ingest failed but continuing (MEMORIA_MCP_STRICT=0)"
    fi
  fi
else
  echo "[enhance] skipped (set LIBSQL_URL to enable enhancement mode)"
fi

echo "Hybrid memory workflow completed."
