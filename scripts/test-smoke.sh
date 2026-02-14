#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_MEMORIA_HOME="$(mktemp -d)"
trap 'rm -rf "$TMP_MEMORIA_HOME"' EXIT

SESSION_FILE="$ROOT_DIR/examples/session.sample.json"

if [ ! -f "$SESSION_FILE" ]; then
  echo "Missing sample session: $SESSION_FILE"
  exit 1
fi

echo "[smoke] init"
MEMORIA_HOME="$TMP_MEMORIA_HOME" "$ROOT_DIR/cli" init

echo "[smoke] sync"
MEMORIA_HOME="$TMP_MEMORIA_HOME" "$ROOT_DIR/cli" sync "$SESSION_FILE"

echo "[smoke] verify"
MEMORIA_HOME="$TMP_MEMORIA_HOME" "$ROOT_DIR/cli" verify

echo "[smoke] export"
MEMORIA_HOME="$TMP_MEMORIA_HOME" "$ROOT_DIR/cli" export --type all --format json --out "$TMP_MEMORIA_HOME/.memory/exports"

echo "[smoke] prune(dry-run)"
MEMORIA_HOME="$TMP_MEMORIA_HOME" "$ROOT_DIR/cli" prune --all --dry-run

if [ ! -f "$TMP_MEMORIA_HOME/.memory/sessions.db" ]; then
  echo "sessions.db was not created"
  exit 1
fi

DAILY_COUNT=$(ls "$TMP_MEMORIA_HOME/knowledge/Daily"/*.md 2>/dev/null | wc -l | tr -d ' ')
DECISION_COUNT=$(ls "$TMP_MEMORIA_HOME/knowledge/Decisions"/*.md 2>/dev/null | wc -l | tr -d ' ')
SKILL_COUNT=$(ls "$TMP_MEMORIA_HOME/knowledge/Skills"/*.md 2>/dev/null | wc -l | tr -d ' ')

if [ "$DAILY_COUNT" -lt 1 ] || [ "$DECISION_COUNT" -lt 1 ] || [ "$SKILL_COUNT" -lt 1 ]; then
  echo "Expected synced markdown outputs were not created"
  echo "Daily: $DAILY_COUNT Decisions: $DECISION_COUNT Skills: $SKILL_COUNT"
  exit 1
fi

echo "[smoke] ok"
