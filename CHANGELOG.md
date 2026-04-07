# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [1.7.0] - 2026-04-07

### Added
- Compiled wiki workflows for Memoria, including raw source import, generated `knowledge/index.md` / `log.md` / `overview.md`, query file-back, and durable wiki lint findings.
- Focused wiki coverage in CI for ingest, build, query filing, and governance lint flows.

### Changed
- Agent guidance, operations docs, release SOP, and skill instructions now treat the compiled wiki as a first-class runtime workflow.

## [1.6.0] - 2026-04-01

### Added
- No-clone release packaging via `pnpm run release:package`, including a Linux x64 runtime tarball with packaged `better-sqlite3` dependencies.
- Artifact-based installer flow and no-clone end-to-end coverage for `preflight`, `setup --serve --json`, `remember`, and `recall`.

### Changed
- `preflight` and `setup` now distinguish repo mode from installed mode, so packaged runtimes no longer require `pnpm` or repo-local dependency installation.
- README, install guide, release SOP, and CI now document and validate the release-asset installation path.

## [1.5.1] - 2026-04-01

### Added
- Native ESM adapter runtime regression test at `scripts/test-adapter-runtime.sh` and CI coverage for bootstrap + adapter runtime verification.

### Fixed
- `./cli setup` now resolves the project install directory from the CLI entrypoint instead of `MEMORIA_HOME`, so bootstrap setup no longer runs `pnpm install` in the wrong location.
- `scripts/test-bootstrap.sh` now resolves repo root correctly.
- `BaseAdapter` now constructs `MemoriaClient` without CommonJS `require()`, so URL-string configuration works under native ESM runtime.

### Changed
- Release and operations docs now include the bootstrap + adapter runtime verification steps in the patch release SOP.

## [1.5.0] - 2026-03-17

### Added
- Adaptive retrieval gate for trivial recall queries (greetings, emoji-only messages, short confirmations) when no explicit recall mode or memory-intent phrase is present.
- Import guardrails that suppress exact duplicate events within a session and derive a better session summary from higher-signal events when the provided summary is trivial.
- Lightweight scope isolation: sessions can carry optional `scope`, which defaults to `project:<project>` or `global`, and recall/index flows can filter by scope.
- Governance review command (`memoria govern review`) for deterministic surfacing of repeated decisions and skills worth extracting.

### Changed
- Recall telemetry and stats now include `route_mode=skipped` when adaptive retrieval intentionally bypasses lookup.

## [1.4.0] - 2026-03-03

### Added
- Time-decay scoring for recall: memory relevance now decreases with age using `1 / (1 + age/halfLife)` (halfLife=90 days). Newer memories rank higher when token match is equal.
- Keyword recall (`recallKeyword`) now computes relevance scores and sorts by score instead of timestamp-only ordering.
- Recall hit tracking: `recallTree` updates `last_synced_at` on matched `memory_nodes` for stale detection.
- `prune --consolidate-days <N>`: merges old session nodes under the same topic node (keeps newest, removes ≥3 old children).
- `prune --stale-days <N>`: removes `memory_nodes` (level=2) never recalled and orphan sessions older than N days.
- `prune --all` now includes `--consolidate-days 90` and `--stale-days 180` by default.

### Changed
- `scoreNode()` accepts optional timestamp parameter for time-decay weighting.
- `recallKeyword()` return type now includes `score` field.
- `recall()` in `MemoriaCore` no longer synthesises position-based scores; uses actual computed scores.

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
