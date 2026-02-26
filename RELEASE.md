# Release Guide

Standard release workflow for Memoria.

Use this guide for every tagged release to keep versioning, artifacts, and docs consistent.

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
node dist/cli.mjs --help
bash -n install.sh
bash scripts/test-smoke.sh
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
5. Rebuild bundle: `pnpm run build` (updates `dist/cli.mjs`)

## Release Procedure

1. Ensure working tree is clean:

```bash
git status
```

2. Apply version/doc updates.

3. Re-run verification commands (same as pre-release checklist).

4. Commit release:

```bash
git add package.json src/cli.ts install.sh CHANGELOG.md dist/cli.mjs
git commit -m "Release vX.Y.Z"
```

5. Create annotated tag:

```bash
git tag -a vX.Y.Z -m "Release vX.Y.Z"
```

6. Push branch and tag:

```bash
git push
git push origin vX.Y.Z
```

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
