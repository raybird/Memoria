#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

echo "[wiki-file] import session"
MEMORIA_HOME="$TMP_DIR" node "$ROOT_DIR/dist/cli.mjs" sync "$ROOT_DIR/examples/session.sample.json" >/dev/null

echo "[wiki-file] file query"
OUTPUT="$(MEMORIA_HOME="$TMP_DIR" node "$ROOT_DIR/dist/cli.mjs" wiki file-query --query "TS CLI" --title "TS Migration Brief" --kind synthesis --scope "project:Memoria" --mode hybrid --json)"
echo "$OUTPUT" | node -e "const fs=require('node:fs');const data=JSON.parse(fs.readFileSync(0,'utf8'));if(!data.ok||!data.data||!data.data.artifact||!data.data.page||!Array.isArray(data.data.hits)||data.data.hits.length===0) process.exit(1)"

page_path=$(echo "$OUTPUT" | node -e "const fs=require('node:fs');const data=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(data.data.page.filepath)")
[ -f "$page_path" ]
grep -q "TS Migration Brief" "$page_path"
grep -q "Evidence" "$page_path"

echo "[wiki-file] rebuild index"
MEMORIA_HOME="$TMP_DIR" node "$ROOT_DIR/dist/cli.mjs" wiki build >/dev/null
grep -q "TS Migration Brief" "$TMP_DIR/knowledge/index.md"

echo "[wiki-file] ok"
