#!/usr/bin/env bash

set -euo pipefail

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

MEMORIA_HOME="$MEMORIA_HOME_OVERRIDE" ./cli init
MEMORIA_HOME="$MEMORIA_HOME_OVERRIDE" ./cli sync "$SESSION_JSON"
MEMORIA_HOME="$MEMORIA_HOME_OVERRIDE" ./cli stats

echo "Memoria sync workflow completed."
