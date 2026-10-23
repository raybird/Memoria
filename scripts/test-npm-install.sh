#!/usr/bin/env bash

set -euo pipefail

# This script asserts what a PACKED npm install can do, and the package deliberately ships the vector
# helper as source with no node_modules — the ~700MB embedding runtime stays opt-in. So a developer
# who has semantic recall wired into their shell profile exports MEMORIA_EMBED_PROVIDER=local, the
# final `doctor --json` inherits it, and the embedder check correctly reports "@huggingface/
# transformers missing" against a package that is not supposed to carry it. The assertion below is
# `checks.every(ok)`, so the whole gate goes red on a correct diagnosis of the wrong subject.
# LIBSQL_URL leaks the same way and was already measuring the developer's REAL vector store against
# this temp DB (embedded=92 expected=0) — benign only by luck of the denominator. CI sets none of
# these, so it only bites locally, and it blocked a release. Same failure mode, same remedy, and the
# same two lines as scripts/test-vector-recall.sh.
unset LIBSQL_URL LIBSQL_AUTH_TOKEN MEMORIA_EMBED_PROVIDER MEMORIA_VECTOR_RECALL_CMD MEMORIA_VECTOR_TIMEOUT_MS
unset MEMORIA_HOME MEMORIA_DB_PATH MEMORIA_SESSIONS_PATH MEMORIA_CONFIG_PATH MEMORIA_USER_CONFIG_PATH
unset XDG_DATA_HOME XDG_CONFIG_HOME CODEX_HOME APPDATA LOCALAPPDATA

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

# The vector helper ships as source only (its ~700MB embedding runtime stays in devDependencies).
# Without these files in the package, resolveHelperScript() can never find a helper on an npm
# install and mode:'vector' degrades to vector_unavailable forever — which is exactly what happened
# before this was fixed. node_modules must NOT come along.
echo "[npm-install] vector helper source is packaged (source only, no node_modules)"
HELPER_DIR="$PREFIX/node_modules/@raybird.chen/memoria/skills/memoria-vector"
for f in vector-recall.mjs vector-ingest.mjs embed.mjs deps.mjs package.json package-lock.json; do
    [ -f "$HELPER_DIR/$f" ] || { echo "Vector helper missing from package: $f"; exit 1; }
done
[ ! -d "$HELPER_DIR/node_modules" ] || { echo "Vector helper node_modules must not be packaged"; exit 1; }
# resolveHelperScript() resolves <dist>/../skills/memoria-vector/vector-recall.mjs — assert that
# exact relationship rather than just "a file exists somewhere".
[ -f "$PREFIX/node_modules/@raybird.chen/memoria/dist/../skills/memoria-vector/vector-recall.mjs" ] || {
    echo "Helper not reachable at the path resolveHelperScript() computes"; exit 1; }

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

echo "[npm-install] unified global setup persists across new processes & deploys both hosts (issue-28)"
ISO_HOME="$TMP_DIR/iso-home"
ISO_XDG="$TMP_DIR/iso-xdg"
OTHER_CWD="$TMP_DIR/other-cwd"
mkdir -p "$ISO_HOME" "$ISO_XDG" "$OTHER_CWD"

(cd "$OTHER_CWD" && HOME="$ISO_HOME" XDG_CONFIG_HOME="$ISO_XDG" "$CLI" setup --scope global --agent both --no-vector --yes >/dev/null)
[ -x "$ISO_HOME/.claude/skills/memoria/bin/memoria" ] || { echo "Claude host launcher missing"; exit 1; }
[ -x "$ISO_HOME/.codex/skills/memoria/bin/memoria" ] || { echo "Codex host launcher missing"; exit 1; }
[ -f "$ISO_HOME/.claude/CLAUDE.md" ] && [ -f "$ISO_HOME/.codex/AGENTS.md" ] || { echo "Host instruction files missing"; exit 1; }

(cd "$OTHER_CWD" && HOME="$ISO_HOME" XDG_CONFIG_HOME="$ISO_XDG" "$CLI" remember "Packed npm global onboarding decision" --project npm-e2e --rationale "verify cross-process persistence" >/dev/null)
GLOBAL_DOC="$(cd "$OTHER_CWD" && HOME="$ISO_HOME" XDG_CONFIG_HOME="$ISO_XDG" "$ISO_HOME/.codex/skills/memoria/bin/memoria" doctor --json)"
echo "$GLOBAL_DOC" | node -e "
const d = JSON.parse(require('node:fs').readFileSync(0, 'utf8'))
if (!d.ok || d.homeSource !== 'global-config') process.exit(1)
if (!d.checks.every((c) => c.ok)) process.exit(1)
"
GLOBAL_RECALL="$(cd "$OTHER_CWD" && HOME="$ISO_HOME" XDG_CONFIG_HOME="$ISO_XDG" "$ISO_HOME/.claude/skills/memoria/bin/memoria" recall "Packed npm global onboarding" --json)"
echo "$GLOBAL_RECALL" | node -e "
const d = JSON.parse(require('node:fs').readFileSync(0, 'utf8'))
if (!d.ok || !Array.isArray(d.data) || d.data.length === 0) process.exit(1)
"

echo "[npm-install] ok"
