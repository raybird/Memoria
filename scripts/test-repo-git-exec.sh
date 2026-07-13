#!/usr/bin/env bash
# issue-1 Phase 0: read-only git exec layer (allowlist enforcement), config.json loader, host id.
#
# Key contracts:
#   1. only spec §5 read subcommands run; write commands and global-flag injection are rejected
#   2. `git tag` is list-only (creation is a write)
#   3. non-git paths classify as not_a_git_repository
#   4. missing config.json -> spec §27 defaults; malformed/invalid config -> descriptive throw
#   5. host id is a generated-once stable UUID

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

FIXTURE="$TMP_DIR/fixture"
echo "[repo-git-exec] fixture repo"
git init -q "$FIXTURE"
git -C "$FIXTURE" -c user.name=memoria-test -c user.email=test@memoria.local \
    commit -q --allow-empty -m "init"

mkdir -p "$TMP_DIR/not-git" "$TMP_DIR/home"

echo "[repo-git-exec] driver assertions"
(cd "$ROOT_DIR" && pnpm exec tsx scripts/repo-git-exec-driver.mts "$FIXTURE" "$TMP_DIR/not-git" "$TMP_DIR/home")

echo "[repo-git-exec] non-invasive: fixture untouched"
STATUS_OUT="$(git -C "$FIXTURE" status --porcelain)"
if [ -n "$STATUS_OUT" ]; then
    echo "  ✗ fixture repo has unexpected changes:"
    echo "$STATUS_OUT"
    exit 1
fi
echo "  ✓ git status clean"

echo "[repo-git-exec] PASS"
