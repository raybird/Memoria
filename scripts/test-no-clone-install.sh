#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -e "const fs=require('node:fs');process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],'utf8')).version);" "$ROOT_DIR/package.json")"
ARTIFACT_PATH="${1:-$ROOT_DIR/dist/release/memoria-linux-x64-v${VERSION}.tar.gz}"
TMP_DIR="$(mktemp -d)"
INSTALL_DIR="$TMP_DIR/install"
WORK_DIR="$TMP_DIR/work"
SESSION_FILE="$TMP_DIR/session.json"
PORT=13918

cleanup() {
  if [ -n "${SERVE_PID:-}" ]; then
    kill "$SERVE_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

if [ ! -f "$ARTIFACT_PATH" ]; then
  echo "Missing release artifact: $ARTIFACT_PATH"
  exit 1
fi

if [ "$INSTALL_DIR" = "$ROOT_DIR" ]; then
  echo "Install dir must not be repo root"
  exit 1
fi

mkdir -p "$WORK_DIR"

echo "[no-clone] install artifact"
bash "$ROOT_DIR/install.sh" --artifact "$ARTIFACT_PATH" --install-dir "$INSTALL_DIR"

echo "[no-clone] verify installed launcher"
(cd "$WORK_DIR" && "$INSTALL_DIR/bin/memoria" --help >/dev/null)

echo "[no-clone] preflight"
PREFLIGHT_OUTPUT="$(cd "$WORK_DIR" && "$INSTALL_DIR/bin/memoria" preflight --json)"
echo "$PREFLIGHT_OUTPUT"
echo "$PREFLIGHT_OUTPUT" | node -e "const fs=require('node:fs');const data=JSON.parse(fs.readFileSync(0,'utf8'));if(!data.ok||data.mode!=='installed') process.exit(1)"

echo "[no-clone] render fixture"
node "$ROOT_DIR/scripts/render-no-clone-fixture.mjs" "$SESSION_FILE"

echo "[no-clone] setup --serve --json"
(cd "$WORK_DIR" && "$INSTALL_DIR/bin/memoria" setup --serve --port "$PORT" --json) &
SERVE_PID=$!

READY=0
for _ in $(seq 1 20); do
  if curl -sf "http://localhost:$PORT/v1/health" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 0.5
done

if [ "$READY" -ne 1 ]; then
  echo "Installed server did not become ready"
  exit 1
fi

echo "[no-clone] remember"
REMEMBER_OUTPUT="$(curl -sf -X POST "http://localhost:$PORT/v1/remember" -H "Content-Type: application/json" -d "@$SESSION_FILE")"
echo "$REMEMBER_OUTPUT" | node -e "const fs=require('node:fs');const data=JSON.parse(fs.readFileSync(0,'utf8'));if(!data.ok) process.exit(1)"

echo "[no-clone] recall"
RECALL_OUTPUT="$(curl -sf -X POST "http://localhost:$PORT/v1/recall" -H "Content-Type: application/json" -d '{"query":"no-clone installer decision","top_k":3}')"
echo "$RECALL_OUTPUT" | node -e "const fs=require('node:fs');const data=JSON.parse(fs.readFileSync(0,'utf8'));if(!data.ok) process.exit(1)"

echo "[no-clone] ok"
