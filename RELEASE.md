# Release Guide

Standard release workflow for Memoria. Releases are **tag-driven** — push a `v*` tag and GitHub Actions handles GitHub Release creation and npm publish.

## Quick SOP (recommended)

From repo root, working tree clean:

```bash
# 1. Bump version (updates package.json / install.sh / DEPLOYED_SKILL.md / docs/INSTALL.md)
pnpm run release:bump <patch|minor|major>

# 2. Edit CHANGELOG.md — move [Unreleased] items into a new [X.Y.Z] - YYYY-MM-DD section
$EDITOR CHANGELOG.md

# 3. Local pre-flight (CI will run the same checks, but cheaper to catch failures here)
pnpm run check
pnpm run build
pnpm run release:docs-check
pnpm run release:package
bash scripts/test-smoke.sh
bash scripts/test-bootstrap.sh
bash scripts/test-no-clone-install.sh
bash scripts/test-installer-platform.sh
bash scripts/test-service-manager.sh
bash scripts/test-npm-install.sh

# 4. Commit + tag + push
git add -A
git commit -m "Release vX.Y.Z"
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push --follow-tags
```

After `git push --follow-tags`, the `release.yml` workflow:

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

- `dist/release/memoria-linux-x64-vX.Y.Z.tar.gz`
- `dist/release/memoria-linux-arm64-vX.Y.Z.tar.gz`
- `dist/release/memoria-darwin-x64-vX.Y.Z.tar.gz`
- `dist/release/memoria-darwin-arm64-vX.Y.Z.tar.gz`
- A `.tar.gz.sha256` sidecar for every native artifact, plus standalone `install.sh`
- `@raybird.chen/memoria` on npm — published from `dist/cli.mjs` + bundled deployed skill

Artifact layout (tarball):

- `bin/memoria`
- `lib/cli.mjs`
- `skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md`
- `skills/memoria-memory-sync/deployed/DEPLOYED_REFERENCE.md`
- `node_modules/`
- `install.sh`

npm tarball contents (controlled by `package.json` `files`):

- `dist/cli.mjs` (executable, `#!/usr/bin/env node`)
- `skills/memoria-memory-sync/deployed/`
- `examples/session.sample.json`
- `README.md` / `README.zh-TW.md` / `CHANGELOG.md` / `LICENSE`

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
