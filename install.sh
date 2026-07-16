#!/usr/bin/env bash
# AI Agent 持久化記憶系統 - 快速安裝腳本 v1.20.0

set -euo pipefail

VERSION="1.20.0"
SUPPORTED_PLATFORMS="linux-x64 linux-arm64 darwin-x64 darwin-arm64"
DEFAULT_INSTALL_DIR="${HOME}/.local/share/memoria"

ARTIFACT_SOURCE=""
INSTALL_DIR="$DEFAULT_INSTALL_DIR"
REQUESTED_VERSION="$VERSION"
REQUESTED_PLATFORM=""
PRINT_RELEASE_URL=0
PLATFORM=""
DEFAULT_ARTIFACT_NAME=""
DEFAULT_RELEASE_URL=""

usage() {
  cat <<EOF
Memoria 快速安裝腳本 v${VERSION}

Usage:
  ./install.sh [--artifact <path-or-url>] [--install-dir <path>]
               [--version <tag-or-semver>] [--platform <os-arch>]

Options:
  --artifact <path-or-url>  Local release tarball path or HTTPS URL
  --install-dir <path>      Install runtime into this directory
  --version <tag-or-semver> Release version/tag to download when --artifact is omitted
  --platform <os-arch>      Override auto-detection (linux/darwin × x64/arm64)
  --print-release-url       Print the resolved release artifact URL and exit
  -h, --help                Show this help message

Examples:
  ./install.sh --artifact ./memoria-linux-x64-v${VERSION}.tar.gz
  ./install.sh --version ${VERSION} --install-dir "${HOME}/memoria"
  ./install.sh --version ${VERSION} --platform darwin-arm64 --print-release-url

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

validate_platform() {
  case " $SUPPORTED_PLATFORMS " in
    *" $1 "*) ;;
    *) fail "unsupported platform: '$1' (supported: $SUPPORTED_PLATFORMS)" ;;
  esac
}

detect_platform() {
  local detected
  detected="$(node -p "process.platform + '-' + process.arch")"
  validate_platform "$detected"
  printf '%s\n' "$detected"
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

validate_version() {
  local clean="${1#v}"
  # Accept semver (1.2.3) with an optional pre-release/build suffix; reject anything else before
  # it is interpolated into a download URL.
  [[ "$clean" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.+][0-9A-Za-z.-]+)?$ ]] \
    || fail "invalid --version: '$1' (expected a semver like 1.2.3 or v1.2.3)"
}

resolve_release_url() {
  local raw_version="$1"
  local platform="$2"
  local normalized="$raw_version"

  if [[ "$normalized" != v* ]]; then
    normalized="v${normalized}"
  fi

  local clean_version="${normalized#v}"
  printf 'https://github.com/raybird/Memoria/releases/download/%s/memoria-%s-v%s.tar.gz\n' "$normalized" "$platform" "$clean_version"
}

# Verify the downloaded tarball against a SHA256 sidecar (<source>.sha256). The sidecar is fetched
# from the same URL, or read next to a local artifact. If none is available (older release, local
# build), it warns and continues; a present-but-mismatching checksum is a hard failure.
verify_checksum() {
  local artifact_path="$1" checksum_source="$2"
  local sums_file="$TMP_DIR/artifact.sha256"

  if [[ "$checksum_source" =~ ^https?:// ]]; then
    if ! (has_cmd curl && curl -fsSL "$checksum_source" -o "$sums_file" 2>/dev/null); then
      echo "⚠ no checksum published at $checksum_source — skipping integrity verification" >&2
      return 0
    fi
  elif [ -f "$checksum_source" ]; then
    cp "$checksum_source" "$sums_file"
  else
    echo "⚠ no checksum sidecar ($checksum_source) — skipping integrity verification" >&2
    return 0
  fi

  local hasher=""
  if has_cmd sha256sum; then hasher="sha256sum"
  elif has_cmd shasum; then hasher="shasum -a 256"
  else
    echo "⚠ no sha256sum/shasum available — skipping integrity verification" >&2
    return 0
  fi

  local expected actual
  expected="$(awk 'NF {print $1; exit}' "$sums_file")"
  [ -n "$expected" ] || { echo "⚠ empty checksum sidecar — skipping verification" >&2; return 0; }
  actual="$($hasher "$artifact_path" | awk '{print $1}')"
  [ "$expected" = "$actual" ] || fail "checksum mismatch (expected $expected, got $actual) — refusing to install"
  echo "✓ checksum verified (sha256)"
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
      validate_version "$2"
      REQUESTED_VERSION="$2"
      shift 2
      ;;
    --platform)
      [ "$#" -ge 2 ] || fail "missing value for --platform"
      validate_platform "$2"
      REQUESTED_PLATFORM="$2"
      shift 2
      ;;
    --print-release-url)
      PRINT_RELEASE_URL=1
      shift
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

PLATFORM="${REQUESTED_PLATFORM:-$(detect_platform)}"
validate_platform "$PLATFORM"
REQUESTED_CLEAN_VERSION="${REQUESTED_VERSION#v}"
DEFAULT_ARTIFACT_NAME="memoria-${PLATFORM}-v${REQUESTED_CLEAN_VERSION}.tar.gz"
DEFAULT_RELEASE_URL="$(resolve_release_url "$REQUESTED_VERSION" "$PLATFORM")"

if [ "$PRINT_RELEASE_URL" -eq 1 ]; then
  [ -z "$ARTIFACT_SOURCE" ] || fail "--print-release-url cannot be combined with --artifact"
  printf '%s\n' "$DEFAULT_RELEASE_URL"
  exit 0
fi

if [ -z "$ARTIFACT_SOURCE" ]; then
  ARTIFACT_SOURCE="$DEFAULT_RELEASE_URL"
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
echo "- platform: $PLATFORM"
echo "- install dir: $INSTALL_DIR"
echo "- artifact: $ARTIFACT_SOURCE"
echo ""

mkdir -p "$EXTRACT_DIR" "$INSTALL_DIR"
download_artifact "$ARTIFACT_SOURCE" "$ARTIFACT_PATH"
verify_checksum "$ARTIFACT_PATH" "${ARTIFACT_SOURCE}.sha256"
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
echo "1. Choose a data root (default setup path: ./memoria from your working directory)"
echo "2. $INSTALL_DIR/bin/memoria preflight --json"
echo "3. $INSTALL_DIR/bin/memoria setup --serve --json"
echo "   or: $INSTALL_DIR/bin/memoria setup --memoria-home \"/path/to/memoria-data\" --serve --json"
