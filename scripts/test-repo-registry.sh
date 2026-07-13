#!/usr/bin/env bash
# issue-1 Phase 1: repository registry (spec §29 "Repository 管理" acceptance).
#
# Key contracts:
#   1. a valid git repository registers; a plain directory is rejected
#   2. two clones/paths of the same history map to ONE logical repository (fingerprint dedupe)
#   3. re-running `repo add` is idempotent (created=false, same id)
#   4. `repo relocate` re-binds a moved clone; identity mismatch is rejected
#   5. `repo remove` stops scanning but keeps rows (status=disabled)
#   6. the whole flow is non-invasive: managed repos stay byte-identical (status + .git/config)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT_DIR/cli"
TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

export MEMORIA_HOME="$TMP_DIR/home"

json_get() { # $1=json $2=node expression over parsed `d`
    node -e "const d=JSON.parse(process.argv[1]); const v=($2); process.stdout.write(String(v))" "$1"
}
assert_eq() { # $1=label $2=actual $3=expected
    if [ "$2" != "$3" ]; then echo "  ✗ $1: expected '$3', got '$2'"; exit 1; fi
    echo "  ✓ $1"
}

make_repo() { # $1=path — seed a UNIQUE file so root commits (and fingerprints) differ per fixture
    git init -q "$1"
    echo "seed: $(basename "$1") $RANDOM$RANDOM" > "$1/seed.txt"
    git -C "$1" add seed.txt
    git -C "$1" -c user.name=memoria-test -c user.email=test@memoria.local commit -q -m "init $(basename "$1")"
    echo "more" >> "$1/seed.txt"
    git -C "$1" -c user.name=memoria-test -c user.email=test@memoria.local commit -q -am "second"
}

echo "[repo-registry] fixtures"
make_repo "$TMP_DIR/alpha"
make_repo "$TMP_DIR/gamma"
mkdir -p "$TMP_DIR/plain"
CONFIG_BEFORE="$(md5sum "$TMP_DIR/alpha/.git/config" | cut -d' ' -f1)"

echo "[repo-registry] add is idempotent and dedupes clones"
ADD1=$("$CLI" repo add "$TMP_DIR/alpha" --json)
assert_eq "add ok" "$(json_get "$ADD1" "d.ok")" "true"
assert_eq "created on first add" "$(json_get "$ADD1" "d.data.created")" "true"
REPO_ID=$(json_get "$ADD1" "d.data.repository.id")

ADD2=$("$CLI" repo add "$TMP_DIR/alpha" --json)
assert_eq "re-add not created" "$(json_get "$ADD2" "d.data.created")" "false"
assert_eq "re-add same id" "$(json_get "$ADD2" "d.data.repository.id")" "$REPO_ID"

cp -r "$TMP_DIR/alpha" "$TMP_DIR/alpha-clone"
ADD3=$("$CLI" repo add "$TMP_DIR/alpha-clone" --json)
assert_eq "clone maps to same repository" "$(json_get "$ADD3" "d.data.repository.id")" "$REPO_ID"
assert_eq "clone gets its own instance" \
    "$(test "$(json_get "$ADD3" "d.data.instance.id")" != "$(json_get "$ADD1" "d.data.instance.id")" && echo differs)" "differs"

echo "[repo-registry] non-git path rejected"
if "$CLI" repo add "$TMP_DIR/plain" --json >/dev/null 2>&1; then
    echo "  ✗ plain directory was accepted"; exit 1
fi
echo "  ✓ plain directory rejected"

echo "[repo-registry] list + status"
"$CLI" repo add "$TMP_DIR/gamma" --name gamma-repo --json >/dev/null
LIST=$("$CLI" repo list --json)
assert_eq "list has 2 logical repositories" "$(json_get "$LIST" "d.data.length")" "2"

STATUS=$("$CLI" repo status "$REPO_ID" --json)
assert_eq "status ok" "$(json_get "$STATUS" "d.ok")" "true"
assert_eq "live head present" "$(json_get "$STATUS" "d.data.live && d.data.live.head_sha ? 'yes' : 'no'")" "yes"
assert_eq "head not moved yet" "$(json_get "$STATUS" "d.data.live.head_moved_since_last_seen")" "false"

STATUS_BY_NAME=$("$CLI" repo status gamma-repo --json)
assert_eq "status resolves by name" "$(json_get "$STATUS_BY_NAME" "d.data.repository.name")" "gamma-repo"

echo "[repo-registry] relocate"
GAMMA_ID=$(json_get "$STATUS_BY_NAME" "d.data.repository.id")
mv "$TMP_DIR/gamma" "$TMP_DIR/gamma-moved"
RELOC=$("$CLI" repo relocate "$GAMMA_ID" "$TMP_DIR/gamma-moved" --json)
assert_eq "relocate ok" "$(json_get "$RELOC" "d.ok")" "true"
assert_eq "relocated path" "$(json_get "$RELOC" "d.data.instance.local_path")" "$TMP_DIR/gamma-moved"
STATUS_AFTER=$("$CLI" repo status "$GAMMA_ID" --json)
assert_eq "live works after relocate" "$(json_get "$STATUS_AFTER" "d.data.live ? 'yes' : 'no'")" "yes"

if "$CLI" repo relocate "$GAMMA_ID" "$TMP_DIR/alpha" --json >/dev/null 2>&1; then
    echo "  ✗ identity mismatch relocate was accepted"; exit 1
fi
echo "  ✓ identity mismatch relocate rejected"

echo "[repo-registry] remove keeps rows, flips status"
REMOVE=$("$CLI" repo remove "$GAMMA_ID" --json)
assert_eq "remove status disabled" "$(json_get "$REMOVE" "d.data.status")" "disabled"
LIST2=$("$CLI" repo list --json)
assert_eq "removed repo still listed" "$(json_get "$LIST2" "d.data.length")" "2"
assert_eq "listed as disabled" \
    "$(json_get "$LIST2" "d.data.find(x => x.repository.id === '$GAMMA_ID').repository.status")" "disabled"

echo "[repo-registry] non-invasive"
STATUS_OUT="$(git -C "$TMP_DIR/alpha" status --porcelain)"
if [ -n "$STATUS_OUT" ]; then echo "  ✗ alpha has unexpected changes"; echo "$STATUS_OUT"; exit 1; fi
CONFIG_AFTER="$(md5sum "$TMP_DIR/alpha/.git/config" | cut -d' ' -f1)"
assert_eq ".git/config untouched" "$CONFIG_AFTER" "$CONFIG_BEFORE"

echo "[repo-registry] PASS"
