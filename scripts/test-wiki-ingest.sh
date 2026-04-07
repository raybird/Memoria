#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
SOURCE_FILE="$TMP_DIR/source.md"

cleanup() {
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

echo "[wiki-ingest] render fixture"
node "$ROOT_DIR/scripts/render-wiki-source-fixture.mjs" "$SOURCE_FILE"

echo "[wiki-ingest] import source"
IMPORT_OUTPUT="$(MEMORIA_HOME="$TMP_DIR" node "$ROOT_DIR/dist/cli.mjs" source add "$SOURCE_FILE" --json)"
echo "$IMPORT_OUTPUT" | node -e "const fs=require('node:fs');const data=JSON.parse(fs.readFileSync(0,'utf8'));if(!data.ok||!data.data||!data.data.source||!data.data.page) process.exit(1)"

echo "[wiki-ingest] list sources"
LIST_OUTPUT="$(MEMORIA_HOME="$TMP_DIR" node "$ROOT_DIR/dist/cli.mjs" source list --json)"
echo "$LIST_OUTPUT" | node -e "const fs=require('node:fs');const data=JSON.parse(fs.readFileSync(0,'utf8'));if(!data.ok||!Array.isArray(data.data)||data.data.length!==1) process.exit(1)"

echo "[wiki-ingest] verify source summary page"
summary_page=$(echo "$IMPORT_OUTPUT" | node -e "const fs=require('node:fs');const data=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(data.data.page.filepath)")
[ -f "$summary_page" ]

echo "[wiki-ingest] verify stored raw source"
stored_source=$(echo "$IMPORT_OUTPUT" | node -e "const fs=require('node:fs');const data=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(data.data.source.origin_path)")
[ -f "$stored_source" ]

echo "[wiki-ingest] dedupe same source"
DEDUPED_OUTPUT="$(MEMORIA_HOME="$TMP_DIR" node "$ROOT_DIR/dist/cli.mjs" source add "$SOURCE_FILE" --json)"
echo "$DEDUPED_OUTPUT" | node -e "const fs=require('node:fs');const data=JSON.parse(fs.readFileSync(0,'utf8'));if(!data.ok||data.data.deduped!==true) process.exit(1)"

echo "[wiki-ingest] ok"
