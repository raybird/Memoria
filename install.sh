#!/usr/bin/env bash
# AI Agent 持久化記憶系統 - 快速安裝腳本 v1.6.0

set -euo pipefail

VERSION="1.6.0"
PLATFORM="linux-x64"
DEFAULT_ARTIFACT_NAME="memoria-${PLATFORM}-v${VERSION}.tar.gz"
DEFAULT_RELEASE_URL="https://github.com/raybird/Memoria/releases/download/v${VERSION}/${DEFAULT_ARTIFACT_NAME}"
DEFAULT_INSTALL_DIR="${HOME}/.local/share/memoria"

ARTIFACT_SOURCE=""
INSTALL_DIR="$DEFAULT_INSTALL_DIR"
REQUESTED_VERSION="$VERSION"

usage() {
  cat <<EOF
Memoria 快速安裝腳本 v${VERSION}

Usage:
  ./install.sh [--artifact <path-or-url>] [--install-dir <path>] [--version <tag-or-semver>]

Options:
  --artifact <path-or-url>  Local release tarball path or HTTPS URL
  --install-dir <path>      Install runtime into this directory
  --version <tag-or-semver> Release version/tag to download when --artifact is omitted
  -h, --help                Show this help message

Examples:
  ./install.sh --artifact ./dist/release/${DEFAULT_ARTIFACT_NAME}
  ./install.sh --artifact https://github.com/raybird/Memoria/releases/download/v${VERSION}/${DEFAULT_ARTIFACT_NAME}
  ./install.sh --version ${VERSION} --install-dir "${HOME}/memoria"

Installed layout:
  <install-dir>/bin/memoria
  <install-dir>/lib/cli.mjs
  <install-dir>/node_modules/

Next step after install:
  <install-dir>/bin/memoria setup --serve --json
EOF
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

fail() {
  echo "✗ $1" >&2
  exit 1
}

download_artifact() {
  local source="$1"
  local destination="$2"

  if [[ "$source" =~ ^https?:// ]]; then
    if has_cmd curl; then
      curl -fsSL "$source" -o "$destination"
      return
    fi
    fail "curl is required to download artifact URLs"
  fi

  if [ ! -f "$source" ]; then
    fail "artifact not found: $source"
  fi

  cp "$source" "$destination"
}

resolve_release_url() {
  local raw_version="$1"
  local normalized="$raw_version"

  if [[ "$normalized" != v* ]]; then
    normalized="v${normalized}"
  fi

  local clean_version="${normalized#v}"
  printf 'https://github.com/raybird/Memoria/releases/download/%s/memoria-%s-v%s.tar.gz\n' "$normalized" "$PLATFORM" "$clean_version"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --artifact)
      [ "$#" -ge 2 ] || fail "missing value for --artifact"
      ARTIFACT_SOURCE="$2"
      shift 2
      ;;
    --install-dir)
      [ "$#" -ge 2 ] || fail "missing value for --install-dir"
      INSTALL_DIR="$2"
      shift 2
      ;;
    --version)
      [ "$#" -ge 2 ] || fail "missing value for --version"
      REQUESTED_VERSION="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown option: $1"
      ;;
  esac
done

if ! has_cmd node; then
  fail "Node.js >= 18 is required"
fi

if ! has_cmd tar; then
  fail "tar is required to extract release artifacts"
fi

if [ -z "$ARTIFACT_SOURCE" ]; then
  if [ "$REQUESTED_VERSION" = "$VERSION" ]; then
    ARTIFACT_SOURCE="$DEFAULT_RELEASE_URL"
  else
    ARTIFACT_SOURCE="$(resolve_release_url "$REQUESTED_VERSION")"
  fi
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

ARTIFACT_PATH="$TMP_DIR/$DEFAULT_ARTIFACT_NAME"
EXTRACT_DIR="$TMP_DIR/extracted"

echo "=================================="
echo "AI Agent 持久化記憶系統"
echo "快速安裝腳本 v${VERSION}"
echo "=================================="
echo ""
echo "[preflight]"
echo "- node: $(node --version)"
echo "- install dir: $INSTALL_DIR"
echo "- artifact: $ARTIFACT_SOURCE"
echo ""

mkdir -p "$EXTRACT_DIR" "$INSTALL_DIR"
download_artifact "$ARTIFACT_SOURCE" "$ARTIFACT_PATH"
tar -C "$EXTRACT_DIR" -xzf "$ARTIFACT_PATH"

EXTRACTED_ROOTS=("$EXTRACT_DIR"/*)
[ "${#EXTRACTED_ROOTS[@]}" -eq 1 ] || fail "expected a single top-level directory in artifact"
EXTRACTED_ROOT="${EXTRACTED_ROOTS[0]}"

for required_path in \
  "$EXTRACTED_ROOT/bin/memoria" \
  "$EXTRACTED_ROOT/lib/cli.mjs" \
  "$EXTRACTED_ROOT/node_modules"; do
  [ -e "$required_path" ] || fail "artifact missing required path: $required_path"
done

rm -rf \
  "$INSTALL_DIR/bin" \
  "$INSTALL_DIR/lib" \
  "$INSTALL_DIR/node_modules" \
  "$INSTALL_DIR/install.sh" \
  "$INSTALL_DIR/package.json" \
  "$INSTALL_DIR/pnpm-lock.yaml" \
  "$INSTALL_DIR/VERSION"

cp -R "$EXTRACTED_ROOT"/. "$INSTALL_DIR"/
chmod +x "$INSTALL_DIR/bin/memoria" "$INSTALL_DIR/install.sh"

echo "✓ Runtime installed"
echo ""
echo "Installed files:"
echo "- $INSTALL_DIR/bin/memoria"
echo "- $INSTALL_DIR/lib/cli.mjs"
echo "- $INSTALL_DIR/node_modules"
echo ""
echo "Next steps:"
echo "1. export MEMORIA_HOME=\"$INSTALL_DIR\""
echo "2. $INSTALL_DIR/bin/memoria preflight --json"
echo "3. $INSTALL_DIR/bin/memoria setup --serve --json"
