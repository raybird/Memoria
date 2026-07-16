#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="$ROOT_DIR/install.sh"
VERSION="$(node -e "const fs=require('node:fs');process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],'utf8')).version)" "$ROOT_DIR/package.json")"
CURRENT_PLATFORM="$(node -p "process.platform + '-' + process.arch")"
BASE_URL="https://github.com/raybird/Memoria/releases/download"

assert_url() {
  local platform="$1"
  local raw_version="$2"
  local clean_version="${raw_version#v}"
  local actual expected
  actual="$(bash "$INSTALLER" --version "$raw_version" --platform "$platform" --print-release-url)"
  expected="$BASE_URL/v${clean_version}/memoria-${platform}-v${clean_version}.tar.gz"
  [ "$actual" = "$expected" ] || {
    echo "URL mismatch for $platform: expected $expected, got $actual"
    exit 1
  }
}

echo "[installer-platform] auto-detect current Node platform"
AUTO_URL="$(bash "$INSTALLER" --version "$VERSION" --print-release-url)"
EXPECTED_AUTO="$BASE_URL/v${VERSION}/memoria-${CURRENT_PLATFORM}-v${VERSION}.tar.gz"
[ "$AUTO_URL" = "$EXPECTED_AUTO" ] || {
  echo "Auto-detected URL mismatch: expected $EXPECTED_AUTO, got $AUTO_URL"
  exit 1
}

echo "[installer-platform] map supported release targets"
for platform in linux-x64 linux-arm64 darwin-x64 darwin-arm64; do
  assert_url "$platform" "v$VERSION"
done

echo "[installer-platform] reject unsupported platform"
if bash "$INSTALLER" --platform freebsd-x64 --print-release-url >/dev/null 2>&1; then
  echo "Unsupported platform should fail"
  exit 1
fi

echo "[installer-platform] reject artifact/URL-print conflict"
if bash "$INSTALLER" --artifact ./local.tar.gz --print-release-url >/dev/null 2>&1; then
  echo "--artifact with --print-release-url should fail"
  exit 1
fi

echo "[installer-platform] help works without resolving an artifact"
bash "$INSTALLER" --help >/dev/null

echo "[installer-platform] ok"
