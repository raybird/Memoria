#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_MEMORIA_HOME="$(mktemp -d)"
TMP_LIBSQL_DB="$(mktemp -u).db"
trap 'rm -rf "$TMP_MEMORIA_HOME"; rm -f "$TMP_LIBSQL_DB"' EXIT

SESSION_FILE="$ROOT_DIR/examples/session.sample.json"

if [ ! -f "$SESSION_FILE" ]; then
  echo "Missing sample session: $SESSION_FILE"
  exit 1
fi

echo "[mcp-e2e] run hybrid sync"
LIBSQL_URL="file:$TMP_LIBSQL_DB" \
  MEMORIA_MCP_STRICT=1 \
  bash "$ROOT_DIR/skills/memoria-memory-sync/scripts/run-sync-with-enhancement.sh" "$SESSION_FILE" "$TMP_MEMORIA_HOME"

MCP_EXPORT_DIR="$TMP_MEMORIA_HOME/.memory/exports/mcp-bridge"
if [ ! -d "$MCP_EXPORT_DIR" ]; then
  echo "MCP bridge export dir missing: $MCP_EXPORT_DIR"
  exit 1
fi

REQUEST_COUNT=$(ls "$MCP_EXPORT_DIR"/*.mcp-requests.json 2>/dev/null | wc -l | tr -d ' ')
if [ "$REQUEST_COUNT" -lt 1 ]; then
  echo "Expected MCP request bundle was not generated"
  exit 1
fi

echo "[mcp-e2e] ok"
