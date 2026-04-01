# Release Guide

Standard release workflow for Memoria.

Use this guide for every tagged release to keep versioning, artifacts, and docs consistent.

## Patch SOP

Use this exact sequence for a normal patch release from repo root:

```bash
pnpm install
pnpm run release:docs-check
pnpm run check
pnpm run build
pnpm run release:package
node dist/cli.mjs --help
bash -n install.sh
bash scripts/test-smoke.sh
bash scripts/test-bootstrap.sh
bash scripts/test-adapter-runtime.sh
bash scripts/test-no-clone-install.sh
bash scripts/test-mcp-e2e.sh
git status
npm version patch --no-git-tag-version
pnpm run build
pnpm run release:package
git add package.json pnpm-lock.yaml src/cli.ts install.sh CHANGELOG.md README.md RELEASE.md docs/INSTALL.md docs/OPERATIONS.md AGENTS.md scripts/package-release-artifacts.sh scripts/render-no-clone-fixture.mjs scripts/test-bootstrap.sh scripts/test-adapter-runtime.sh scripts/test-no-clone-install.sh src/adapter/adapter.ts .github/workflows/ci.yml dist/cli.mjs dist/install/memoria
git commit -m "Release vX.Y.Z"
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push
git push origin vX.Y.Z
```

If `npm version patch` updates files beyond `package.json`, review them before commit.

If the release includes the new no-clone installation path, prefer a minor release over a patch release.

## Scope

This process covers:

- Version bump
- Changelog preparation
- Local verification (CI parity)
- Git commit + tag
- Push to remote

## Release Types

- Patch (`x.y.Z`): bug fixes and small docs updates
- Minor (`x.Y.z`): backward-compatible features and workflow improvements
- Major (`X.y.z`): breaking CLI/data behavior changes

## Pre-Release Checklist

Run from repo root:

```bash
pnpm install
pnpm run release:docs-check
pnpm run check
pnpm run build
pnpm run release:package
node dist/cli.mjs --help
bash -n install.sh
bash scripts/test-smoke.sh
bash scripts/test-bootstrap.sh
bash scripts/test-adapter-runtime.sh
bash scripts/test-no-clone-install.sh
bash scripts/test-mcp-e2e.sh
```

If any command fails, do not release.

`release:docs-check` validates high-signal doc sync points automatically:

- Version alignment (`package.json`, `src/cli.ts`, `install.sh`)
- `CHANGELOG.md` contains current version section
- Core docs include current telemetry/index/incremental MCP behavior

## Files to Update

For a normal release, update:

1. `package.json` version
2. `src/cli.ts` `.version(...)`
3. `install.sh` banner version
4. `CHANGELOG.md` move `Unreleased` changes into new version section
5. `README.md`, `docs/INSTALL.md`, `RELEASE.md`, and `docs/OPERATIONS.md` if verification or release steps changed
6. Rebuild bundle: `pnpm run build` (updates `dist/cli.mjs`)
7. Repackage release runtime: `pnpm run release:package` (updates `dist/install/memoria` and `dist/release/...tar.gz`)

## Release Procedure

1. Ensure working tree is clean:

```bash
git status
```

2. Apply version/doc updates.

3. Re-run verification commands (same as pre-release checklist).

4. Commit release:

```bash
git add package.json pnpm-lock.yaml src/cli.ts install.sh CHANGELOG.md README.md RELEASE.md docs/INSTALL.md docs/OPERATIONS.md AGENTS.md scripts/package-release-artifacts.sh scripts/render-no-clone-fixture.mjs scripts/test-bootstrap.sh scripts/test-adapter-runtime.sh scripts/test-no-clone-install.sh src/adapter/adapter.ts .github/workflows/ci.yml dist/cli.mjs dist/install/memoria
git commit -m "Release vX.Y.Z"
```

Do not commit `dist/release/*.tar.gz`; those are release assets, not tracked source artifacts.

5. Create annotated tag:

```bash
git tag -a vX.Y.Z -m "Release vX.Y.Z"
```

6. Push branch and tag:

```bash
git push
git push origin vX.Y.Z
```

7. Create or update the GitHub release asset for the Linux x64 tarball:

```bash
gh release create vX.Y.Z dist/release/memoria-linux-x64-vX.Y.Z.tar.gz --notes-file CHANGELOG.md
# or, if the release already exists:
gh release upload vX.Y.Z dist/release/memoria-linux-x64-vX.Y.Z.tar.gz --clobber
```

## Release Artifacts

Current supported release artifact:

- `memoria-linux-x64-vX.Y.Z.tar.gz`

Artifact layout:

- `bin/memoria`
- `lib/cli.mjs`
- `node_modules/`
- `install.sh`

CI packages this artifact on every PR/push, runs `bash scripts/test-no-clone-install.sh`, then uploads the tarball as a workflow artifact.

## Post-Release Checks

Verify the pushed state:

```bash
git status
git tag --list | grep "vX.Y.Z"
```

Expected:

- `working tree clean`
- tag exists on remote

## Optional: GitHub Release Notes

Suggested sections:

- Highlights
- Added
- Changed
- Migration Notes (if any)
- Verification commands

Use content from `CHANGELOG.md` as source of truth.

## Rollback Notes

If release commit/tag is incorrect and not consumed yet:

```bash
git tag -d vX.Y.Z
git push --delete origin vX.Y.Z
```

Then create a corrected release tag.

Do not force-push `main` unless explicitly approved.
