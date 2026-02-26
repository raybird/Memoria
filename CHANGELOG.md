# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [1.3.0] - 2026-02-26

### Added
- Tree memory index schema (`memory_nodes`, `memory_node_sources`) and `memoria index build` command.
- Tree/hybrid recall mode with explainable `reasoning_path` metadata.
- Recall routing telemetry with aggregated stats and raw API endpoint (`GET /v1/telemetry/recall`).
- MCP sync cursor state (`memory_sync_state`) and post-ingest cursor commit script.
- Incremental MCP payload mode (`MEMORIA_MCP_PAYLOAD_MODE=incremental`, default) with compatibility fallback to `full`.

### Changed
- `memoria sync` now auto-builds incremental tree index by default (`MEMORIA_INDEX_AUTOBUILD=0` to disable).
- Hybrid MCP flow now supports true no-op second sync (entities/relations unchanged when no deltas).
- `memoria stats` now reports 7-day recall routing quality (fallback rate, route counts, latency, hit count).
- Operations and MCP docs updated for tree recall observability and incremental sync controls.

## [1.2.0] - 2026-02-14

### Added
- `memoria sync --dry-run` for validation and write-preview without mutating files.
- `memoria stats` command for sessions/events/skills summary and top skills.
- `memoria verify` command for runtime/schema/writeability validation with `--json` output.
- Agent Skill at `skills/memoria-memory-sync/SKILL.md` with references, resources, and helper scripts.
- Hybrid MCP bridge automation (`run-sync-with-enhancement.sh`) for optional `mcp-memory-libsql` ingestion.
- Installer preflight checks for common container tools (`node`, `pnpm`, `npm`, `git`, `unzip`, `python3`).
- Explicit path env support: `MEMORIA_DB_PATH`, `MEMORIA_SESSIONS_PATH`, `MEMORIA_CONFIG_PATH`.
- Bundled CLI build output at `dist/cli.mjs` with `pnpm run build`.

### Changed
- Session JSON parsing now validates schema with clearer error messages.
- README now documents dry-run and stats command usage.
- Documentation now includes agentskills integration and MCP/libSQL auto-ingest workflow.
- Installer now supports npm fallback and `--minimal`/`--no-git` modes.
- CLI launcher now works with pnpm or npm (no hard pnpm requirement at runtime).
- `./cli` now prefers built artifact (`dist/cli.mjs`) when available.

## [1.1.1] - 2026-02-13

### Added
- GitHub Actions CI workflow for TypeScript and shell validation.
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
- Install and hook flow updated to TS-only runtime.
- Path handling aligned around `MEMORIA_HOME`.
- Ignore rules hardened for safer open-source sharing.
