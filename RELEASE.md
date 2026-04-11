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
bash scripts/test-wiki-ingest.sh
bash scripts/test-wiki-build.sh
bash scripts/test-wiki-query-fileback.sh
bash scripts/test-wiki-lint.sh
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

## Fast SOP

Use this when you need the shortest human-friendly release checklist.

1. Confirm working tree is clean with `git status`.
2. Update versioned files:
   - `package.json`
   - `src/cli.ts`
   - `install.sh`
   - `CHANGELOG.md`
   - docs affected by install / release / skill behavior
3. Run the full pre-release checklist.
4. Run `pnpm run release:package` again after the version bump.
5. Confirm the artifact includes deployed skill docs and no-clone tests still pass.
6. Commit release changes with `Release vX.Y.Z`.
7. Create annotated tag `vX.Y.Z`.
8. Push branch and tag.
9. Publish or upload `dist/release/memoria-linux-x64-vX.Y.Z.tar.gz` to GitHub Releases.

Release should stop immediately if any of these fail:

- `pnpm run release:docs-check`
- `pnpm run release:package`
- `bash scripts/test-bootstrap.sh`
- `bash scripts/test-no-clone-install.sh`

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
bash scripts/test-wiki-ingest.sh
bash scripts/test-wiki-build.sh
bash scripts/test-wiki-query-fileback.sh
bash scripts/test-wiki-lint.sh
```

If any command fails, do not release.

`release:docs-check` validates high-signal doc sync points automatically:

- Version alignment (`package.json`, `src/cli.ts`, `install.sh`)
- `CHANGELOG.md` contains current version section
- Core docs include current telemetry/index/incremental MCP behavior

`release:package` 現在也會額外驗證 deployed skill packaging contract：

- `skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md` version 必須等於 `package.json.version`
- deployed skill artifact 必須含 `DEPLOYED_SKILL.md` / `DEPLOYED_REFERENCE.md`
- deployed skill 文件不得殘留 repo-only 指令（例如 `./cli`, `bash skills/`, `node skills/`, `git clone`）

## Files to Update

For a normal release, update:

1. `package.json` version
2. `src/cli.ts` `.version(...)`
3. `install.sh` banner version
4. `CHANGELOG.md` move `Unreleased` changes into new version section
5. `README.md`, `docs/INSTALL.md`, `RELEASE.md`, and `docs/OPERATIONS.md` if verification or release steps changed
6. Rebuild bundle: `pnpm run build` (updates `dist/cli.mjs`)
7. Repackage release runtime: `pnpm run release:package` (updates `dist/install/memoria` and `dist/release/...tar.gz`)

8. If skill or installer behavior changed, verify README / `docs/INSTALL.md` / deployed skill docs still match shipped runtime behavior

9. If deployed skill behavior changed, verify these still agree with the shipped artifact:
   - `skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md`
   - `skills/memoria-memory-sync/deployed/DEPLOYED_REFERENCE.md`
   - `skills/memoria-memory-sync/resources/mcp/INGEST_PLAYBOOK.md`

## Release Procedure

1. Ensure working tree is clean:

```bash
git status
```

2. Apply version/doc updates.

3. Re-run verification commands (same as pre-release checklist).

   Explicitly confirm these release-specific guards passed:

   - deployed skill validator inside `pnpm run release:package`
   - bootstrap deployed skill checks in `bash scripts/test-bootstrap.sh`
   - no-clone deployed skill checks in `bash scripts/test-no-clone-install.sh`

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
- `skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md`
- `skills/memoria-memory-sync/deployed/DEPLOYED_REFERENCE.md`
- `node_modules/`
- `install.sh`

After `setup`, these deploy into:

- `<memoria-home>/.agents/memoria-memory-sync/SKILL.md`
- `<memoria-home>/.agents/memoria-memory-sync/REFERENCE.md`
- `<memoria-home>/.agents/memoria-memory-sync/bin/memoria`

CI packages this artifact on every PR/push, runs `bash scripts/test-no-clone-install.sh`, and verifies the deployed skill layout before uploading the tarball as a workflow artifact.

The release artifact is only considered valid if all of these are true:

- installer boots the packaged runtime without repo source files
- `setup` deploys `.agents/memoria-memory-sync/SKILL.md`
- `setup` deploys `.agents/memoria-memory-sync/REFERENCE.md`
- deployed docs remain runtime-safe
- deployed wrapper can run sync workflows against the packaged runtime

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
