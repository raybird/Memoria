#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -e "const fs=require('node:fs');process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],'utf8')).version)" "$ROOT_DIR/package.json")"
TMP_DIR="$(mktemp -d)"
PACK_DIR="$TMP_DIR/package"
PREFIX="$TMP_DIR/npm prefix"
DATA_DIR="$TMP_DIR/data root"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mkdir -p "$PACK_DIR"

echo "[npm-install] detect repo mode through direct tsx runtime"
REPO_LAYOUT="$(cd "$ROOT_DIR" && pnpm exec tsx -e "import { getRuntimeLayout } from './src/cli/runtime.ts'; console.log(JSON.stringify(getRuntimeLayout()))")"
echo "$REPO_LAYOUT" | node -e "const fs=require('node:fs');const data=JSON.parse(fs.readFileSync(0,'utf8'));if(data.mode!=='repo'||data.runtimeRoot!==process.argv[1])process.exit(1)" "$ROOT_DIR"

echo "[npm-install] pack published files"
PACK_OUTPUT="$(cd "$ROOT_DIR" && npm pack --silent --pack-destination "$PACK_DIR")"
PACKAGE_NAME="$(printf '%s\n' "$PACK_OUTPUT" | tail -n 1)"
PACKAGE_PATH="$PACK_DIR/$PACKAGE_NAME"
[ -f "$PACKAGE_PATH" ] || { echo "Packed npm artifact not found: $PACKAGE_PATH"; exit 1; }

echo "[npm-install] install package into isolated prefix"
npm install --silent --no-audit --no-fund --prefix "$PREFIX" "$PACKAGE_PATH"
CLI="$PREFIX/node_modules/.bin/memoria"
[ -x "$CLI" ] || { echo "Installed npm launcher missing: $CLI"; exit 1; }

echo "[npm-install] verify installed mode"
PREFLIGHT_OUTPUT="$("$CLI" preflight --json)"
echo "$PREFLIGHT_OUTPUT" | node -e "const fs=require('node:fs');const data=JSON.parse(fs.readFileSync(0,'utf8'));if(!data.ok||data.mode!=='installed')process.exit(1)"

echo "[npm-install] setup data root with spaces"
SETUP_OUTPUT="$("$CLI" setup --memoria-home "$DATA_DIR" --json)"
echo "$SETUP_OUTPUT" | node -e "
const fs=require('node:fs')
const rows=fs.readFileSync(0,'utf8').trim().split(/\n+/).map((line)=>JSON.parse(line))
if(rows.some((row)=>!row.ok)) process.exit(1)
for(const required of ['preflight','install','init','verify','skill']) {
  if(!rows.some((row)=>row.step===required)) process.exit(1)
}
"

echo "[npm-install] verify human-readable setup output"
HUMAN_OUTPUT="$("$CLI" setup --memoria-home "$DATA_DIR")"
printf '%s\n' "$HUMAN_OUTPUT" | grep -q "Data initialized: $DATA_DIR"
printf '%s\n' "$HUMAN_OUTPUT" | grep -q "Database verified: $DATA_DIR/.memory/sessions.db"
printf '%s\n' "$HUMAN_OUTPUT" | grep -q "Memoria setup complete."

SKILL_BIN="$DATA_DIR/.agents/skills/memoria/bin/memoria"
[ -x "$SKILL_BIN" ] || { echo "Deployed skill launcher missing: $SKILL_BIN"; exit 1; }
grep -q '/dist/cli.mjs' "$SKILL_BIN" || {
  echo "Deployed npm skill launcher does not target the packaged dist CLI"
  exit 1
}

echo "[npm-install] execute deployed skill launcher"
[ "$("$SKILL_BIN" --version)" = "$VERSION" ] || {
  echo "Deployed skill launcher returned the wrong version"
  exit 1
}

DOCTOR_OUTPUT="$(MEMORIA_HOME="$DATA_DIR" "$SKILL_BIN" doctor --json)"
echo "$DOCTOR_OUTPUT" | node -e "
const fs=require('node:fs')
const data=JSON.parse(fs.readFileSync(0,'utf8'))
if(!data.ok||data.homeSource!=='env') process.exit(1)
if(!data.checks.every((check)=>check.ok)) process.exit(1)
"

echo "[npm-install] ok"
