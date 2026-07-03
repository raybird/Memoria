# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [1.16.2] - 2026-07-03

### Changed
- HTTP request bodies for all POST endpoints (`/v1/remember`, `/v1/recall`, `/v1/sources`, `/v1/wiki/file-query`, `/v1/wiki/lint`) are now validated with Zod at the boundary instead of ad-hoc field-presence checks plus `as` casts. Malformed payloads — a wrong-typed field, an invalid `mode` / `kind` / `type` enum value, or a non-array `events` — are rejected with a descriptive `400` before reaching core, rather than being cast through and potentially crashing it. Valid requests are unaffected. Covered by new `test-http-api.sh` assertions.

## [1.16.1] - 2026-07-03

### Fixed
- The adaptive recall gate no longer over-skips short CJK queries. Its length threshold counted every character equally, so an information-dense query like `連線池設定` (5 chars) fell under the 8-character floor and was skipped without recalling. CJK characters (ideographs, kana, hangul) are now weighted, so short meaningful CJK queries recall while short ASCII fragments, greetings, and common Chinese confirmations still skip. ASCII query behaviour is unchanged.

## [1.16.0] - 2026-07-03

### Added
- Schema migration upgrade regression test (`scripts/test-migrations.sh`) and HTTP endpoint contract test (`scripts/test-http-api.sh`), both wired into CI. The migration test exercises the previously-untested path of upgrading a *populated* pre-migration database — DDL re-application, data backfill (`recall_fts`, telemetry columns), row preservation, and idempotency. The HTTP test covers `GET /v1/sessions/:id/summary`, `POST`/`GET /v1/sources`, and `POST /v1/wiki/build|file-query|lint` plus their 400/404 error paths (also covering the `summarizeSession` / `listSources` read methods).

### Changed
- The Codex, Antigravity, and Claude Code hook adapters now share a `StdinHookAdapter` base (new SDK export) that centralizes hook-event dispatch, recall + prompt-buffering on inject, dedupe + write on stop, and injected-context formatting. Each concrete adapter now only declares its event names, conversation-id default, turn extraction, and output shape — removing the ~90% duplication between them with no behavior change.

## [1.15.1] - 2026-07-02

### Fixed
- Agent hook adapters (Codex / Antigravity / Claude Code) now deduplicate writes across hook processes. Each `memoria adapter <name>` invocation is a separate short-lived process, so the previous in-memory throttle state reset every time and a duplicate `Stop` (double-fire / re-run) re-wrote the same turn. Throttle/dedupe state now persists per conversation — under `MEMORIA_ADAPTER_STATE_DIR`, else `$MEMORIA_HOME/.memory/adapter-state`, else the system temp dir — keyed by a turn content hash: identical repeats are skipped while distinct turns always write (no turn is dropped). The previously-dead `dedupeWindowSec` config now bounds this dedupe window (0 = always skip an identical repeat).
- Codex / Antigravity `Stop` turns now carry the user prompt. The prompt from `UserPromptSubmit` / `PreInvocation` is buffered and read back on `Stop`, so persisted `ConversationTurn` events contain both `user` and `assistant` text instead of `user: ''` (which degraded later recall relevance).

## [1.15.0] - 2026-07-02

### Added
- Recall telemetry now records a privacy-preserving `query_hash`, query `token_count`, and the calibrated `top_confidence` per query (migration `recall_telemetry_add_query_metrics`). `stats.recallRouting` / `GET /v1/stats` gain `zeroHitRate` and `avgConfidence` computed over non-skipped queries; `GET /v1/telemetry/recall` rows expose the new per-query fields. `/v1/telemetry/recall` gains its first end-to-end test coverage in `test-smoke.sh`.

### Changed
- Recall `meta.confidence` is now the top hit's decay-free match quality — a new per-hit `relevance` field (fraction of query tokens matched) — decoupled from time-decay. Previously `confidence` was the ranking score, so a strong match on an old memory reported a low value, and a query whose terms appear in every indexed document reported ~0 (bm25 IDF). Ranking (`score` = relevance × time-decay) is unchanged, so ordering is unaffected.

## [1.14.0] - 2026-07-02

### Changed
- Keyword recall (`recall` mode `keyword`) now ranks with SQLite FTS5 + BM25 instead of a whole-query `LIKE '%q%'` scan plus substring scoring. A new migration (`recall_fts5_index`) adds a `trigram`-tokenized `recall_fts` virtual table over session summaries and Decision/Skill events, kept in sync by triggers with a one-time backfill for existing databases. `recallKeyword` runs FTS5 `MATCH` + `bm25()` as the primary path (folded into the existing time-decay envelope) and falls back to the original `LIKE` scan for sub-trigram (1–2 char) / CJK-short queries and any FTS miss, so behaviour is a strict superset with no regression. Multi-word queries now match on any term and rank documents containing more / rarer terms higher.

## [1.13.0] - 2026-07-02

### Added
- Codex CLI and Antigravity CLI agent adapters with zero-code hook integration. `memoria adapter codex` and `memoria adapter antigravity` read hook JSON on stdin and return JSON on stdout, mirroring `memoria adapter claude-code`. Codex dispatches `UserPromptSubmit` (recall → `additionalContext`) and `Stop` (writes the turn from `last_assistant_message`); Antigravity dispatches `PreInvocation`/`Stop` and emits `additionalContext` both top-level and nested under `hookSpecificOutput` for build compatibility. Both fail-open so a Memoria outage never disrupts the host agent. The three hook handlers now share one `registerHookHandler` in `src/cli/commands/adapter.ts`.
- `scripts/test-codex-adapter.sh` and `scripts/test-antigravity-adapter.sh` end-to-end tests, wired into `ci.yml`.
- Bundled agent hook wiring templates deployed with the skill: `resources/hooks/{claude-code,codex,antigravity}.hooks.json`, added to the deployed-skill required-asset check. `docs/INSTALL.md` gains a post-install "Agent Hook Integration" section and `SKILL.md` lists the templates.

### Changed
- The Gemini MCP config template is replaced by Codex/Antigravity ones: `resources/mcp/{antigravity-cli,codex-cli}.mcp.json` (was `gemini-cli.mcp.json`). README / README.zh-TW / docs updated to list Claude Code / Antigravity CLI / Codex CLI / OpenCode adapters.

### Removed
- **Breaking (SDK):** the `GeminiAdapter` reference adapter and its `gemini-cli.mcp.json` template are removed. Code importing `GeminiAdapter` from `src/adapter/index.js` should migrate to `CodexAdapter` / `AntigravityAdapter` / `OpenCodeAdapter`. CLI commands and stored data are unaffected.

## [1.12.0] - 2026-06-02

### Added
- Per-folder memory is now first-class: the deployed agent skill explains that runtime and data root (`MEMORIA_HOME`) are separate, so any clean folder can get its own memory by running `setup` there. Deployed `SKILL.md` adds self-location of the data root, a fail-closed "check before write" flow, and a new-folder setup walkthrough.
- `resolveMemoriaHomeInfo()` reports how `MEMORIA_HOME` was resolved (`env` / `detected` / `fallback`). `getMemoriaHome()` delegates to it with unchanged behavior and return type.

### Changed
- `doctor` no longer reports `MEMORIA_HOME` as always healthy. When the home was resolved by silent `fallback` (folder never set up, no env), the check now fails with an actionable `fix` hint, and `doctor --json` exposes a `homeSource` field.
- The deployed agent skill now installs to `<memoria-home>/.agents/skills/memoria/` (was `<memoria-home>/.agents/memoria-memory-sync/`) and is named `memoria`, so agents discover it as the **memoria** skill in `active_skills`. The repo-side source directory `skills/memoria-memory-sync/` is unchanged.
- README / README.zh-TW / docs/INSTALL.md updated for the new deployed path, skill name, and per-folder memory model.

## [1.11.1] - 2026-06-01

### Fixed
- npm-installed `setup` now deploys the full agent skill. The `files` whitelist only published `skills/memoria-memory-sync/deployed/`, so the npm tarball was missing `SKILL.md`, `scripts/`, and `resources/` — `getBundledSkillSourcePath()` found no `SKILL.md` and `deployAgentSkill` was silently skipped, leaving `.agents/memoria-memory-sync/` undeployed. Whitelist now ships the whole `skills/memoria-memory-sync/` directory.
- `setup` now logs a `✗ [skill]` step when the bundled skill source is missing, instead of skipping the step with no output.

## [1.11.0] - 2026-05-24

### Added
- Claude Code adapter: wire Memoria into Anthropic's Claude Code via its hook system without writing any code. One CLI command (`memoria adapter claude-code`) handles both `UserPromptSubmit` (injects recall as `additionalContext`) and `Stop` (writes the just-completed turn from the transcript). Both fail-open so a Memoria outage never disrupts the agent loop.
- `scripts/test-claude-code-adapter.sh` end-to-end test, wired into `ci.yml`.

### Changed
- HTTP server hot path (`recall`, `recallTelemetry`, `stats`) now reuses a cached SQLite connection across requests instead of opening + closing per call. Server SIGINT/SIGTERM handlers drain the pool via `closeAllConnections()`.
- `initDatabase()` no longer inlines `ALTER TABLE` patches. Schema upgrades are tracked in a new `schema_migrations` table, with three numbered migrations corresponding to the previous inline patches.
- `dist/` is now gitignored. Build artifacts (`dist/cli.mjs`, `dist/install/memoria`) are regenerated by `pnpm run build` and `pnpm run release:package`; `prepublishOnly` ensures `npm publish` still works. Removes ~21 k lines of binary-shaped diff from every commit.

## [1.10.0] - 2026-05-24

### Added
- npm publish target: `@raybird.chen/memoria` (scoped public package). `npx @raybird.chen/memoria setup` or `npm install -g @raybird.chen/memoria` now works on Linux / macOS / Windows.
- `scripts/build.mjs` build entry point that emits `dist/cli.mjs` with `#!/usr/bin/env node` shebang and executable permission, so npm-installed users get a working `memoria` binary.
- `scripts/bump-version.mjs` single-command version bump across `package.json`, `src/cli.ts`, `install.sh`, deployed skill, and `docs/INSTALL.md`.
- `.github/workflows/release.yml` — tag-driven release: pushing `v*` runs the pre-release checks, creates the GitHub Release with extracted CHANGELOG notes, and publishes to npm with provenance.

### Changed
- `package.json` flipped from `private: true` to public (`@raybird.chen/memoria`) with a `files` whitelist (9-file, ~148 kB tarball).
- `bin` now points to `dist/cli.mjs` directly instead of the bash wrapper `./cli`, so the npm install entrypoint works cross-platform.
- README / docs/INSTALL.md promote npm as Method A; no-clone tarball and repo dev mode move to Method B / Method C.
- RELEASE.md simplified to the new tag-driven SOP (`release:bump` → CHANGELOG edit → tag push → CI publishes).

## [1.9.0] - 2026-05-24

### Changed
- Split `src/core/db.ts` (2409 lines, 8 domains) into 11 focused modules under `src/core/db/` (`schema`, `session`, `source`, `wiki`, `lint`, `sync`, `telemetry`, `verify`, `prune-export`, `recall`, `mappers`). Public API surface (`src/core/index.ts`) is unchanged — all 32 exports remain.
- Split `src/cli.ts` (~890 lines, 16 commands) into a thin 50-line Commander registration shell, extracting each command into its own module under `src/cli/commands/`, plus shared helpers (`shared.ts`, `runtime.ts`, `preflight.ts`).
- Updated AGENTS.md, README.md, and README.zh-TW.md to reflect the new `src/core/db/` and `src/cli/` directory structure.

## [1.8.0] - 2026-04-11

### Added
- Deployed skill packaging for no-clone installs, including runtime-safe `SKILL.md` and `REFERENCE.md` deployment into `<memoria-home>/.agents/memoria-memory-sync`.
- Release-time validation for deployed skill version alignment, required asset completeness, and repo-only instruction leakage.

### Changed
- `setup` now ships a local `bin/memoria` wrapper with the deployed skill so installed agents can execute skill workflows without a cloned repo.
- README, install guide, and release SOP now document deployed skill discovery, packaging guards, and no-clone release expectations.

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
