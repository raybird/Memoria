# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [1.1.1] - 2026-02-13

### Added
- GitHub Actions CI workflow for TypeScript, shell, and Python fallback validation.
- Smoke test script at `scripts/test-smoke.sh` for end-to-end `init` + `sync` verification.
- `SECURITY.md` with private reporting and open-source data safety guidance.
- MIT `LICENSE` file.

### Changed
- Documentation now includes open-source safety guidance and sample sync test flow.

## [1.1.0] - 2026-02-13

### Added
- TypeScript CLI (`cli`, `src/cli.ts`) with `init`, `sync`, and `doctor` commands.
- Sample session file at `examples/session.sample.json`.

### Changed
- Install and hook flow updated to TS-first with Python fallback.
- Path handling aligned around `MEMORIA_HOME`.
- Ignore rules hardened for safer open-source sharing.
