# Release Guide

Standard release workflow for Memoria. Releases are **tag-driven** — push a `v*` tag and GitHub Actions handles GitHub Release creation and npm publish.

## Quick SOP (recommended)

From repo root, working tree clean:

```bash
# 1. Bump version (updates package.json / src/cli.ts / install.sh / DEPLOYED_SKILL.md / docs/INSTALL.md)
pnpm run release:bump <patch|minor|major>

# 2. Edit CHANGELOG.md — move [Unreleased] items into a new [X.Y.Z] - YYYY-MM-DD section
$EDITOR CHANGELOG.md

# 3. Local pre-flight (CI will run the same checks, but cheaper to catch failures here)
pnpm run release:docs-check
pnpm run check
pnpm run build
pnpm run release:package
bash scripts/test-smoke.sh
bash scripts/test-bootstrap.sh
bash scripts/test-no-clone-install.sh

# 4. Commit + tag + push
git add -A
git commit -m "Release vX.Y.Z"
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push --follow-tags
```

After `git push --follow-tags`, the `release.yml` workflow:

1. Verifies the tag matches `package.json` version.
2. Re-runs docs-check / check / build / package / smoke / bootstrap / no-clone tests.
3. Extracts the matching `[X.Y.Z]` section from `CHANGELOG.md` as release notes.
4. Creates the GitHub Release and uploads `dist/release/memoria-linux-x64-vX.Y.Z.tar.gz`.
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
| `src/cli.ts` | `.version('X.Y.Z')` |
| `install.sh` | `# v…` header + `VERSION="…"` |
| `skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md` | `version: "…"` |
| `docs/INSTALL.md` | `vX.Y.Z` in install commands |

`CHANGELOG.md` is **not** auto-edited — you must add the section by hand so release notes carry your wording.

## Pre-Release Guards

Release should stop immediately if any of these fail (they all run in CI as well):

- `pnpm run release:docs-check` — version alignment + CHANGELOG section + core doc sync
- `pnpm run release:package` — deployed skill packaging contract (`DEPLOYED_SKILL.md` version + required assets + no repo-only instructions)
- `bash scripts/test-bootstrap.sh` — bootstrap deployed skill checks
- `bash scripts/test-no-clone-install.sh` — no-clone deployed skill checks

## Release Artifacts

- `dist/release/memoria-linux-x64-vX.Y.Z.tar.gz` — uploaded to GitHub Release
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
gh release create vX.Y.Z dist/release/memoria-linux-x64-vX.Y.Z.tar.gz --notes-file <(awk '...' CHANGELOG.md)
npm publish --provenance --access public
```
