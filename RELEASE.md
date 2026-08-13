# Release Guide

Standard release workflow for Memoria. Releases are **tag-driven** — push a `v*` tag and GitHub Actions handles GitHub Release creation and npm publish.

## SOP

Two commands. Everything between them is executed, not retyped:

```bash
pnpm run release:prepare <patch|minor|major|X.Y.Z>
$EDITOR CHANGELOG.md      # move [Unreleased] under the new [X.Y.Z] - YYYY-MM-DD heading
pnpm run release:publish
```

`prepare` checks the tree is clean, on `main`, and synced with origin, then bumps the version.
`publish` runs every guard and gate test, commits, tags (annotated), pushes, **waits for the release
workflow to appear and finish**, and then inspects the *published* artifact. The steps live in
`scripts/release.sh` — deliberately as code rather than as a list to copy, because a printed list is
a second copy of the truth and this one drifted twice in a single day (see *Why this is a script*).

CHANGELOG editing stays manual on purpose: release notes carry your wording. `publish` refuses to run
without a matching `## [X.Y.Z] - …` section, since `release.yml` extracts it for the notes and a
missing section fails *after* the tag is public.

Guards `publish` enforces, each from something that actually went wrong:

| Guard | Prevents |
|---|---|
| only version-bump files dirty | a release commit swallowing uncommitted feature work |
| `build` before `release:docs-check` | docs-check asserting a `dist/cli.mjs` that predates the bump |
| annotated tag, pushed **by ref** | `--follow-tags` silently skipping a lightweight tag |
| release run must appear within 2 min | a successful push, an advanced `main`, and no release at all |
| parity check against the **downloaded** artifact | a green workflow that shipped the wrong contents (issue-10) |

After the tag lands, the `release.yml` workflow:

1. Verifies the tag matches `package.json` version.
2. Re-runs docs-check / check / build plus smoke, bootstrap, installer, service, and packed npm tests.
3. Extracts the matching `[X.Y.Z]` section from `CHANGELOG.md` as release notes.
4. Builds and tests native Linux/macOS x64/arm64 artifacts on matching runners, then uploads all tarballs, checksums, and `install.sh`.
5. Publishes `@raybird.chen/memoria` to npm with provenance.

**Required GitHub secret**: `NPM_TOKEN` (automation token from npmjs.com).

## Release Types

- Patch (`x.y.Z`): bug fixes and small docs updates
- Minor (`x.Y.z`): backward-compatible features and workflow improvements
- Major (`X.y.z`): breaking CLI/data behavior changes

## Files Touched by `release:bump`

| File | Field |
|------|-------|
| `package.json` | `version` |
| `install.sh` | `VERSION="…"` |
| `skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md` | `version: "…"` |
| `docs/INSTALL.md` | `vX.Y.Z` in install commands |

`CHANGELOG.md` is **not** auto-edited — you must add the section by hand so release notes carry your wording.

## Pre-Release Guards

Release should stop immediately if any of these fail (they all run in CI as well):

- `pnpm run release:docs-check` — version alignment + CHANGELOG section + core doc sync
- `pnpm run release:package` — deployed skill packaging contract (`DEPLOYED_SKILL.md` version + required assets + no repo-only instructions)
- `bash scripts/test-bootstrap.sh` — bootstrap deployed skill checks
- `bash scripts/test-no-clone-install.sh` — no-clone deployed skill checks
- `bash scripts/test-installer-platform.sh` — Linux/macOS x64/arm64 URL routing contract
- `bash scripts/test-service-manager.sh` — mocked systemd user and LaunchAgent lifecycle
- `bash scripts/test-npm-install.sh` — packed npm layout and installed runtime checks

## Release Artifacts

Four native tarballs plus a `.sha256` sidecar each, a standalone `install.sh`, and
`@raybird.chen/memoria` on npm:

```
dist/release/memoria-{linux,darwin}-{x64,arm64}-vX.Y.Z.tar.gz
```

**Contents are not listed here.** This document used to carry two hand-written inventories, and both
were wrong: they still described a tarball and an npm package from before `skills/memoria-vector`
joined them — the npm side in v1.23.1, the tarball in v1.26.0. A third copy of a file list is a third
thing to keep in sync, which is the disease `check-delivery-parity.mjs` was written to cure. Ask the
artifacts instead:

```bash
npm pack --dry-run          # what npm ships (authoritative: package.json "files")
tar -tf dist/release/memoria-linux-x64-vX.Y.Z.tar.gz   # what the tarball ships
```

The two are not identical by design — the tarball uses a `bin/` + `lib/` layout and carries
`node_modules`, while npm ships `dist/cli.mjs` and the docs. What *is* guaranteed is that nothing npm
ships is missing from the tarball unless it is declared, with a reason, in `DELIVERED_ELSEWHERE`
inside `scripts/check-delivery-parity.mjs`. That check runs in `release:package`, which both
`ci.yml` and `release.yml` execute, and again against the **downloaded** artifact in
`release.sh publish`.

## Why this is a script

The flow used to be a list of commands to retype. On 2026-08-13 that cost two releases' worth of
debugging, both from the same cause — a printed instruction is a second copy of the truth, free to
disagree with the first:

- `bump-version.mjs` printed `git tag vX.Y.Z` (lightweight) followed by `git push --follow-tags`, a
  pair that **cannot** trigger a release: the flag pushes only annotated tags, so the tag is dropped
  in silence — the push succeeds, `main` advances, the workflow never fires, and nothing in the output
  says so. `RELEASE.md` had the correct `git tag -a` the whole time. The recipe a person follows is
  the one the tool just printed, not the one in a file they would have to open.
- This document's artifact inventories had been stale for three releases, as above.

A step that runs cannot disagree with a step that is documented, because there is only one of it.
Where a step genuinely cannot be executed (the CHANGELOG wording), it stays manual and `publish`
*verifies* it instead of describing it.

## Rollback

If the tag is wrong and not yet consumed:

```bash
git tag -d vX.Y.Z
git push --delete origin vX.Y.Z
# GitHub Release can be deleted via `gh release delete vX.Y.Z`
# npm publish cannot be undone after 72h — bump and re-release if needed
```

Do not force-push `main` unless explicitly approved.

## Manual Fallback (if CI is unavailable)

```bash
gh release create vX.Y.Z dist/release/*.tar.gz dist/release/*.tar.gz.sha256 install.sh --notes-file <(awk '...' CHANGELOG.md)
npm publish --provenance --access public
```
