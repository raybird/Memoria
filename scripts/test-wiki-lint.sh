#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

echo "[wiki-lint] import session"
MEMORIA_HOME="$TMP_DIR" node "$ROOT_DIR/dist/cli.mjs" sync "$ROOT_DIR/examples/session.sample.json" >/dev/null

echo "[wiki-lint] create duplicate filed pages"
MEMORIA_HOME="$TMP_DIR" node "$ROOT_DIR/dist/cli.mjs" wiki file-query --query "TS CLI" --title "Duplicate Brief" --kind synthesis --scope "project:Memoria" --mode hybrid >/dev/null
MEMORIA_HOME="$TMP_DIR" node "$ROOT_DIR/dist/cli.mjs" wiki file-query --query "TS CLI" --title "Duplicate Brief" --kind synthesis --scope "project:Memoria" --mode hybrid >/dev/null

echo "[wiki-lint] run lint"
OUTPUT="$(MEMORIA_HOME="$TMP_DIR" node "$ROOT_DIR/dist/cli.mjs" wiki lint --stale-days 0 --json)"
echo "$OUTPUT" | node -e "const fs=require('node:fs');const data=JSON.parse(fs.readFileSync(0,'utf8'));if(!data.ok||!data.data||!data.data.run||!Array.isArray(data.data.findings)||data.data.findings.length===0) process.exit(1); if(!data.data.findings.some((f)=>f.finding_type==='duplicate-page')) process.exit(1);"

echo "[wiki-lint] ok"
