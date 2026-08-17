#!/usr/bin/env bash
#
# Executable release flow.
#
# This exists because the previous flow was a list of commands printed for a human to retype, and a
# printed list is a second copy of the truth. It drifted twice in one day: `bump-version.mjs` printed
# `git tag` (lightweight) + `git push --follow-tags`, a pair that cannot trigger a release — the tag
# is skipped in silence — while RELEASE.md had the correct `-a` all along; and RELEASE.md's artifact
# inventories still described a tarball that had gained a directory three releases earlier. Steps that
# run cannot disagree with steps that are documented, because there is only one of them.
#
# Every guard below is something that actually went wrong, not a hypothetical:
#
#   prepare
#     - clean tree / on main / synced      → never cut a release from work nobody else can see
#     - CHANGELOG section must exist       → release.yml extracts it for the notes; missing = failure
#                                            discovered after the tag is public
#   publish
#     - only bump files dirty              → feature work must already be committed; `git add -A` in a
#                                            release commit once swept a whole feature in with it
#     - build BEFORE docs-check            → docs-check asserts dist embeds the new version
#     - annotated tag + explicit ref push  → `--follow-tags` silently skips lightweight tags
#     - workflow must APPEAR               → the failure mode above produces a successful push, an
#                                            advanced main, and no release, with nothing in the output
#     - inspect the PUBLISHED artifact     → a green workflow says the build passed, not that the
#                                            tarball contains what it should (that was issue-10)
#
# Usage:
#   bash scripts/release.sh prepare <patch|minor|major|X.Y.Z>
#   bash scripts/release.sh publish

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BRANCH="main"
WORKFLOW="release.yml"
# The release workflow is tag-triggered; GitHub takes a few seconds to register the run. Poll rather
# than sleep-and-hope, and treat "never appeared" as a hard failure — that is the tag-not-pushed case.
RUN_POLL_ATTEMPTS=24
RUN_POLL_INTERVAL=5

die() { echo "✗ $*" >&2; exit 1; }
step() { echo; echo "── $* ──"; }

pkg_version() { node -p "require('./package.json').version"; }

require_tools() {
    command -v pnpm >/dev/null 2>&1 || die "pnpm is required"
    command -v gh   >/dev/null 2>&1 || die "gh is required (used to confirm the release actually ran)"
    command -v npm  >/dev/null 2>&1 || die "npm is required"
}

assert_on_branch_and_synced() {
    local current
    current="$(git rev-parse --abbrev-ref HEAD)"
    [ "$current" = "$BRANCH" ] || die "on branch '$current'; releases are cut from '$BRANCH'"
    git fetch --quiet origin "$BRANCH"
    local ahead behind
    ahead="$(git rev-list --count "origin/$BRANCH..$BRANCH")"
    behind="$(git rev-list --count "$BRANCH..origin/$BRANCH")"
    [ "$behind" = "0" ] || die "$BRANCH is $behind commit(s) behind origin; pull first"
    [ "$ahead" = "0" ] || die "$BRANCH is $ahead commit(s) ahead of origin; push your work before releasing"
}

assert_changelog_section() {
    local version="$1"
    grep -Fq "## [$version] - " CHANGELOG.md \
        || die "CHANGELOG.md has no '## [$version] - YYYY-MM-DD' section. release.yml extracts that section as the release notes, so a missing one fails AFTER the tag is public."
}

# HANDOVER §2 is the hand-maintained shipping log, and it drifted: v1.27.0, v1.27.1 and v1.28.0 were
# all released before a downstream pointed out that none of them had a row, while §7's backlog had
# already been marked done. A document whose opening line promises "read this and you can take over"
# is worse than useless when it is three releases stale, so the reminder is a guard rather than a
# habit — the same treatment the CHANGELOG section already gets.
assert_handover_row() {
    local version="$1"
    grep -Fq "| v$version |" docs/HANDOVER.md \
        || die "docs/HANDOVER.md §2 has no row for v$version. That table is the shipping log a future session reads to learn what changed when; it has silently fallen three releases behind before. Add the row, then re-run."
}

# ─────────────────────────────────────────────────────────────────────────────
# prepare
# ─────────────────────────────────────────────────────────────────────────────
cmd_prepare() {
    local level="${1:-}"
    [ -n "$level" ] || die "usage: release.sh prepare <patch|minor|major|X.Y.Z>"
    require_tools

    step "Preconditions"
    [ -z "$(git status --porcelain)" ] || die "working tree is dirty; commit or stash first"
    assert_on_branch_and_synced
    echo "✓ clean tree, on $BRANCH, synced with origin"

    step "Bump version"
    pnpm run release:bump "$level"
    local version
    version="$(pkg_version)"

    step "Next"
    cat <<EOF
Version is now $version. Add its CHANGELOG section by hand — release notes carry your wording,
which is why this step is deliberately not automated:

    ## [$version] - $(date +%Y-%m-%d)

Move the [Unreleased] entries under it, then run:

    bash scripts/release.sh publish
EOF
}

# ─────────────────────────────────────────────────────────────────────────────
# publish
# ─────────────────────────────────────────────────────────────────────────────
cmd_publish() {
    require_tools
    local version tag
    version="$(pkg_version)"
    tag="v$version"

    step "Preconditions for $tag"
    assert_on_branch_and_synced
    assert_changelog_section "$version"
    assert_handover_row "$version"

    # Only the files `release:bump` touches, plus the two documents written AT release time
    # (CHANGELOG's section and HANDOVER §2's row — `assert_handover_row` above requires the latter, so
    # forbidding it here would make the two guards contradict each other; that is exactly what
    # happened the first time both existed). Anything else means feature work is riding along
    # uncommitted — the release commit would swallow it and the history would stop saying what shipped
    # when.
    local unexpected
    unexpected="$(git status --porcelain | awk '{print $2}' | grep -vE '^(package\.json|install\.sh|CHANGELOG\.md|docs/HANDOVER\.md|docs/INSTALL\.md|skills/memoria-memory-sync/deployed/DEPLOYED_SKILL\.md)$' || true)"
    [ -z "$unexpected" ] || die "these files are dirty but are not part of a version bump — commit them first:
$unexpected"

    # Written as an explicit `if` rather than `cmd && die`: under `set -e` the short-circuit form is
    # subtle enough to argue about, and this script must never abort on the success path.
    if git rev-parse -q --verify "refs/tags/$tag" >/dev/null 2>&1; then
        die "tag $tag already exists locally"
    fi
    echo "✓ $tag is unused, CHANGELOG section present, only bump files dirty"

    step "Guards"
    # build precedes docs-check on purpose: docs-check asserts dist/cli.mjs embeds the new version.
    pnpm run check
    pnpm run build
    pnpm run release:docs-check
    pnpm run release:package

    step "Gate tests (mirrors release.yml)"
    for t in test-smoke test-bootstrap test-installer-platform test-service-manager test-npm-install test-no-clone-install; do
        printf '  %-28s' "$t"
        if bash "scripts/$t.sh" >"/tmp/memoria-release-$t.log" 2>&1; then
            echo "PASS"
        else
            echo "FAIL"
            tail -20 "/tmp/memoria-release-$t.log" >&2
            die "$t failed; see /tmp/memoria-release-$t.log"
        fi
    done

    step "Commit + annotated tag"
    git add -A
    git commit -m "Release $tag"
    # Annotated on purpose, and pushed by ref below: `--follow-tags` pushes ONLY annotated tags, so a
    # lightweight one is dropped without a word. Naming the ref makes the tag's type stop deciding
    # whether a release happens at all.
    git tag -a "$tag" -m "Release $tag"
    [ "$(git cat-file -t "$tag")" = "tag" ] || die "$tag is not annotated"

    step "Push"
    git push origin "$BRANCH"
    git push origin "refs/tags/$tag"

    step "Wait for the release workflow to appear"
    local run_id=""
    for _ in $(seq 1 "$RUN_POLL_ATTEMPTS"); do
        run_id="$(gh run list --workflow "$WORKFLOW" --branch "$tag" --event push \
            --json databaseId --jq '.[0].databaseId // empty' 2>/dev/null || true)"
        [ -z "$run_id" ] || break
        sleep "$RUN_POLL_INTERVAL"
    done
    [ -n "$run_id" ] || die "no release workflow appeared for $tag after $((RUN_POLL_ATTEMPTS * RUN_POLL_INTERVAL))s.
The tag is public and must not be reused — investigate, then release a new version."
    echo "✓ run $run_id"

    step "Watch"
    gh run watch "$run_id" --exit-status \
        || die "release workflow failed. The public tag $tag remains and must NOT be reused — fix forward with a new version."

    step "Verify what actually shipped"
    local published
    published="$(npm view @raybird.chen/memoria version)"
    [ "$published" = "$version" ] || die "npm reports $published, expected $version"
    gh release view "$tag" >/dev/null || die "no GitHub Release for $tag"

    # A green workflow proves the build passed, not that the artifact carries what it should. issue-10
    # shipped three releases whose tarball was quietly missing the semantic-recall helper while every
    # check was green, so this asks the published bytes rather than the build log.
    local tmp
    tmp="$(mktemp -d)"
    gh release download "$tag" --pattern "memoria-linux-x64-*.tar.gz" --dir "$tmp" --clobber
    node scripts/check-delivery-parity.mjs "$tmp/memoria-linux-x64-$tag.tar.gz" "memoria-linux-x64-$tag" \
        || die "the PUBLISHED artifact fails delivery parity"
    rm -rf "$tmp"

    step "Released $tag"
    echo "npm: $published"
    echo "GitHub Release: $(gh release view "$tag" --json url --jq .url)"
    echo
    echo "Upgrade a global install with: npm i -g @raybird.chen/memoria@$version"
}

case "${1:-}" in
    prepare) shift; cmd_prepare "$@" ;;
    publish) shift; cmd_publish "$@" ;;
    *) die "usage: release.sh <prepare|publish> [args]" ;;
esac
