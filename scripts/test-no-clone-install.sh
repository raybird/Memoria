#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -e "const fs=require('node:fs');process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],'utf8')).version);" "$ROOT_DIR/package.json")"
PLATFORM="$(node -p "process.platform + '-' + process.arch")"
ARTIFACT_PATH="${1:-$ROOT_DIR/dist/release/memoria-${PLATFORM}-v${VERSION}.tar.gz}"
TMP_DIR="$(mktemp -d)"
TMP_DIR="$(cd "$TMP_DIR" && pwd -P)"
INSTALL_DIR="$TMP_DIR/install"
WORK_DIR="$TMP_DIR/work"
DATA_DIR="$WORK_DIR/memoria"
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

# Packaging emits the SHA256 sidecar; generate it for standalone runs so the checksum path is
# always exercised deterministically (the build dir is gitignored, so this is harmless).
if [ ! -f "${ARTIFACT_PATH}.sha256" ]; then
  if command -v sha256sum >/dev/null 2>&1; then
    ( cd "$(dirname "$ARTIFACT_PATH")" && sha256sum "$(basename "$ARTIFACT_PATH")" > "$(basename "$ARTIFACT_PATH").sha256" )
  elif command -v shasum >/dev/null 2>&1; then
    ( cd "$(dirname "$ARTIFACT_PATH")" && shasum -a 256 "$(basename "$ARTIFACT_PATH")" > "$(basename "$ARTIFACT_PATH").sha256" )
  else
    echo "sha256sum or shasum is required for this test"
    exit 1
  fi
fi

echo "[no-clone] install artifact (with checksum verification)"
INSTALL_OUT="$(bash "$ROOT_DIR/install.sh" --artifact "$ARTIFACT_PATH" --install-dir "$INSTALL_DIR")"
echo "$INSTALL_OUT"
echo "$INSTALL_OUT" | grep -q "checksum verified" || { echo "expected checksum verification during install"; exit 1; }

echo "[no-clone] tampered checksum is rejected"
BAD_DIR="$TMP_DIR/bad"
mkdir -p "$BAD_DIR"
cp "$ARTIFACT_PATH" "$BAD_DIR/artifact.tar.gz"
printf '%s  artifact.tar.gz\n' "0000000000000000000000000000000000000000000000000000000000000000" > "$BAD_DIR/artifact.tar.gz.sha256"
if bash "$ROOT_DIR/install.sh" --artifact "$BAD_DIR/artifact.tar.gz" --install-dir "$TMP_DIR/bad-install" >/dev/null 2>&1; then
  echo "install should have failed on checksum mismatch"
  exit 1
fi
echo "[no-clone] tampered checksum rejected"

echo "[no-clone] reject malformed --version"
if bash "$ROOT_DIR/install.sh" --version "not-a-version" --install-dir "$TMP_DIR/bad-install2" >/dev/null 2>&1; then
  echo "install should have rejected a malformed --version"
  exit 1
fi
echo "[no-clone] malformed --version rejected"

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

echo "[no-clone] verify separated data root"
DOCTOR_OUTPUT="$(cd "$WORK_DIR" && "$INSTALL_DIR/bin/memoria" doctor --json)"
echo "$DOCTOR_OUTPUT" | node -e "const fs=require('node:fs');const data=JSON.parse(fs.readFileSync(0,'utf8'));if(data.paths.memoriaHome!==process.argv[1]) process.exit(1);if(!data.checks.every((check)=>check.ok)) process.exit(1)" "$DATA_DIR"
[ -f "$DATA_DIR/.agents/skills/memoria/SKILL.md" ] || { echo "Expected deployed skill at $DATA_DIR/.agents/skills/memoria/SKILL.md"; exit 1; }
[ -f "$DATA_DIR/.agents/skills/memoria/REFERENCE.md" ] || { echo "Expected deployed reference at $DATA_DIR/.agents/skills/memoria/REFERENCE.md"; exit 1; }
if grep -q './cli\|bash skills/\|node skills/\|git clone' "$DATA_DIR/.agents/skills/memoria/SKILL.md"; then
  echo "Deployed SKILL.md should not contain repo-only guidance"
  exit 1
fi
MEMORIA_BIN="$INSTALL_DIR/bin/memoria" bash "$DATA_DIR/.agents/skills/memoria/scripts/run-sync.sh" "$SESSION_FILE" "$DATA_DIR" >/dev/null
[ ! -e "$INSTALL_DIR/.memory" ] || { echo "Install dir should not contain .memory"; exit 1; }
[ ! -e "$INSTALL_DIR/knowledge" ] || { echo "Install dir should not contain knowledge"; exit 1; }

echo "[no-clone] remember"
REMEMBER_OUTPUT="$(curl -sf -X POST "http://localhost:$PORT/v1/remember" -H "Content-Type: application/json" -d "@$SESSION_FILE")"
echo "$REMEMBER_OUTPUT" | node -e "const fs=require('node:fs');const data=JSON.parse(fs.readFileSync(0,'utf8'));if(!data.ok) process.exit(1)"

echo "[no-clone] recall"
RECALL_OUTPUT="$(curl -sf -X POST "http://localhost:$PORT/v1/recall" -H "Content-Type: application/json" -d '{"query":"no-clone installer decision","top_k":3}')"
echo "$RECALL_OUTPUT" | node -e "const fs=require('node:fs');const data=JSON.parse(fs.readFileSync(0,'utf8'));if(!data.ok) process.exit(1)"

echo "[no-clone] ok"
