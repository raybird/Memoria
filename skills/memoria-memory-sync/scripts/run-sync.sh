#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOCAL_MEMORIA_BIN="$SKILL_ROOT/bin/memoria"

if [ -x "$LOCAL_MEMORIA_BIN" ]; then
  MEMORIA_BIN_DEFAULT="$LOCAL_MEMORIA_BIN"
elif [ -x "./cli" ]; then
  MEMORIA_BIN_DEFAULT="./cli"
else
  MEMORIA_BIN_DEFAULT="memoria"
fi

MEMORIA_BIN="${MEMORIA_BIN:-$MEMORIA_BIN_DEFAULT}"

if [ "$#" -lt 1 ]; then
  echo "Usage: bash skills/memoria-memory-sync/scripts/run-sync.sh <session-json> [memoria-home]"
  exit 1
fi

SESSION_JSON="$1"
MEMORIA_HOME_OVERRIDE="${2:-$(pwd)}"

if [ ! -f "$SESSION_JSON" ]; then
  echo "Session JSON not found: $SESSION_JSON"
  exit 1
fi

MEMORIA_HOME="$MEMORIA_HOME_OVERRIDE" "$MEMORIA_BIN" init
MEMORIA_HOME="$MEMORIA_HOME_OVERRIDE" "$MEMORIA_BIN" sync "$SESSION_JSON"
MEMORIA_HOME="$MEMORIA_HOME_OVERRIDE" "$MEMORIA_BIN" stats

echo "Memoria sync workflow completed."
