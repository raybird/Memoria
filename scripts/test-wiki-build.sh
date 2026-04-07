#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
SOURCE_FILE="$TMP_DIR/source.md"

cleanup() {
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

echo "[wiki-build] render fixture"
node "$ROOT_DIR/scripts/render-wiki-source-fixture.mjs" "$SOURCE_FILE"

echo "[wiki-build] import session"
MEMORIA_HOME="$TMP_DIR" node "$ROOT_DIR/dist/cli.mjs" sync "$ROOT_DIR/examples/session.sample.json" >/dev/null

echo "[wiki-build] import source"
MEMORIA_HOME="$TMP_DIR" node "$ROOT_DIR/dist/cli.mjs" source add "$SOURCE_FILE" >/dev/null

echo "[wiki-build] build wiki"
BUILD_OUTPUT="$(MEMORIA_HOME="$TMP_DIR" node "$ROOT_DIR/dist/cli.mjs" wiki build --json)"
echo "$BUILD_OUTPUT" | node -e "const fs=require('node:fs');const data=JSON.parse(fs.readFileSync(0,'utf8'));if(!data.ok||!data.data||!data.data.specialPages) process.exit(1)"

index_path="$TMP_DIR/knowledge/index.md"
log_path="$TMP_DIR/knowledge/log.md"
overview_path="$TMP_DIR/knowledge/overview.md"

[ -f "$index_path" ]
[ -f "$log_path" ]
[ -f "$overview_path" ]

grep -q "Knowledge Index" "$index_path"
grep -q "source-summary" "$index_path"
grep -q "Knowledge Log" "$log_path"
grep -q "session | session_example_001" "$log_path"
grep -q "source | LLM Wiki Fixture" "$log_path"
grep -q "Knowledge Overview" "$overview_path"

echo "[wiki-build] ok"
