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

echo "[mcp-e2e] run hybrid sync again (incremental)"
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

PAYLOAD_COUNT=$(ls "$MCP_EXPORT_DIR"/mcp-bridge-*.json 2>/dev/null | grep -v '\.mcp-requests\.json$' | wc -l | tr -d ' ')
if [ "$PAYLOAD_COUNT" -lt 2 ]; then
  echo "Expected at least two bridge payloads for incremental check"
  exit 1
fi

FIRST_PAYLOAD=$(ls "$MCP_EXPORT_DIR"/mcp-bridge-*.json 2>/dev/null | grep -v '\.mcp-requests\.json$' | sort | head -n 1)
LAST_PAYLOAD=$(ls "$MCP_EXPORT_DIR"/mcp-bridge-*.json 2>/dev/null | grep -v '\.mcp-requests\.json$' | sort | tail -n 1)

FIRST_CHANGED=$(node -e "const fs=require('node:fs');const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(String(p?.sync?.changed_node_count ?? -1));" "$FIRST_PAYLOAD")
LAST_CHANGED=$(node -e "const fs=require('node:fs');const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(String(p?.sync?.changed_node_count ?? -1));" "$LAST_PAYLOAD")
LAST_MODE=$(node -e "const fs=require('node:fs');const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(String(p?.payload_mode ?? ''));" "$LAST_PAYLOAD")
LAST_ENTITY_COUNT=$(node -e "const fs=require('node:fs');const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(String(Array.isArray(p?.entities)?p.entities.length:-1));" "$LAST_PAYLOAD")

if [ "$FIRST_CHANGED" -lt 1 ]; then
  echo "Expected first payload to include changed tree nodes, got: $FIRST_CHANGED"
  exit 1
fi

if [ "$LAST_CHANGED" -ne 0 ]; then
  echo "Expected second payload to be incremental no-op, got changed_node_count=$LAST_CHANGED"
  exit 1
fi

if [ "$LAST_MODE" != "incremental" ]; then
  echo "Expected payload_mode=incremental by default, got: $LAST_MODE"
  exit 1
fi

if [ "$LAST_ENTITY_COUNT" -ne 0 ]; then
  echo "Expected second payload entities=0 in incremental no-op, got: $LAST_ENTITY_COUNT"
  exit 1
fi

echo "[mcp-e2e] ok"
