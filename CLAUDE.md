# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⚠️ 最重要規則

**Git commit 訊息絕對不可包含 `Co-Authored-By: Claude` 或任何 AI 署名資訊。** 只寫功能描述，不附加任何尾行。

## Project Snapshot

Memoria is a TypeScript CLI + HTTP service that gives AI agents cross-session persistent memory. Runtime is Node.js (≥18, CI uses Node 22) with `better-sqlite3` and `zod`. Package manager is **pnpm** (lockfile is authoritative). ESM-only (`"type": "module"`), TS strict mode.

`AGENTS.md` is the long-form agent guide — read it for HTTP API, bootstrap flow, and code-style detail. `package.json` scripts and `.github/workflows/ci.yml` are the source of truth for commands; if local docs disagree with CI, follow CI.

## Common Commands

```bash
pnpm install                        # install deps (use pnpm, not npm/yarn)
pnpm run check                      # tsc --noEmit  (primary static check)
pnpm run build                      # esbuild bundle -> dist/cli.mjs
pnpm run memoria -- --help          # run CLI in dev via tsx
./cli <command>                     # same entrypoint, shorter
node dist/cli.mjs --help            # smoke-check the production bundle
bash -n install.sh                  # syntax-check the installer
```

`dist/` is gitignored — run `pnpm run build` once after cloning if you want the production bundle. The `./cli` wrapper falls back to `tsx` when `dist/cli.mjs` is missing, so most dev flows work without it.

## Tests

There is **no unit-test framework** (no Jest/Vitest). All tests are bash scripts under `scripts/` that exercise the CLI end-to-end. To run a single flow, invoke its script directly:

```bash
bash scripts/test-smoke.sh                  # CLI full flow (most common)
bash scripts/test-migrations.sh             # schema migration upgrade on a populated old DB
bash scripts/test-prune.sh                  # destructive prune paths (consolidate/stale/dedupe/utility-retention) delete exactly the right rows
bash scripts/test-utility-ranking.sh        # UFL Phase 3 utility-weighted recall ranking (threshold/flip/explicit-override)
bash scripts/test-bootstrap.sh              # ./cli setup self-install
bash scripts/test-adapter-runtime.sh        # adapter ESM runtime
bash scripts/test-utility-shadow.sh         # UFL Phase 0 shadow spike plumbing (reuse signal discriminates)
bash scripts/test-no-clone-install.sh       # install.sh from release tarball
bash scripts/test-mcp-e2e.sh                # MCP/libSQL hybrid + incremental
bash scripts/test-http-api.sh               # HTTP endpoint contracts (sources/wiki/summary/outcome/calibration)
bash scripts/test-vector-recall.sh          # semantic recall (mode:'vector') contract + degradation matrix (stub provider)
bash scripts/test-wiki-ingest.sh            # raw source ingest
bash scripts/test-wiki-build.sh             # compiled wiki special pages
bash scripts/test-wiki-query-fileback.sh    # query file-back
bash scripts/test-wiki-lint.sh              # wiki governance lint
bash scripts/test-repo-git-exec.sh          # git 唯讀執行層白名單 + config loader + host id（issue-1 Phase 0）
bash scripts/test-repo-registry.sh          # repository registry：add/list/status/relocate/remove + fingerprint 去重
bash scripts/test-repo-sync.sh              # 增量掃描：commits/refs/tags 冪等入庫、history-limit、detached HEAD
bash scripts/test-repo-events.sh            # git events：change detector、history rewrite、--dry-run 零寫入、失敗恢復
bash scripts/test-repo-summary.sh           # summary pipeline：range 分組、trivial/secret filter、agent 回寫
bash scripts/test-repo-promotion.sh         # memory promotion + recall 附 Git 來源 + HTTP /v1/repos/* 契約
bash scripts/test-repo-edge.sh              # shallow/unshallow 升級、linked worktree、maxDiffBytes、git-observations prune
bash scripts/test-repo-noninvasive.sh       # 非侵入性總驗收：完整流程後 git 狀態 byte-identical
```

CI runs these in the order listed in `.github/workflows/ci.yml`. Mirror that order locally before opening a PR.

For ad-hoc verification of a CLI flow without running full smoke:

```bash
TMP=$(mktemp -d); MEMORIA_HOME="$TMP" ./cli init
MEMORIA_HOME="$TMP" ./cli sync examples/session.sample.json
```

## Architecture

The CLI (`src/cli.ts`, ~50 lines) is a thin Commander registration shell — it imports each command module and calls its `register*Command()` function. **All business logic lives in `src/core/`**, accessible to CLI, HTTP server, and SDK alike:

- `core/memoria.ts` — `MemoriaCore` class, the public API surface
- `core/db/` — SQLite operations split by domain (open/close lifecycle in `try/finally`):
  - `schema.ts` — `initDatabase` (DDL + migrations)
  - `session.ts` — `importSession`, `listRecentSessions`, `querySessionSummary`
  - `source.ts` — `upsertSourceRecord`, `listSourceRecords`
  - `wiki.ts` — wiki pages, links, artifacts (9 functions)
  - `lint.ts` — wiki lint runs & findings (4 functions)
  - `sync.ts` — `syncDailyNote`, `extractDecisions`, `extractSkills`
  - `telemetry.ts` — `logRecallTelemetry`, `recordRecallOutcome` (UFL write-back + per-memory attribution), `queryStats` (incl. confidence×utility calibration), `queryRecallTelemetry`, `queryGovernanceReview`
  - `verify.ts` — `runVerify`
  - `prune-export.ts` — `runPrune` (utility-weighted retention), `exportMemory`
  - `recall.ts` — `buildMemoryIndex`, `recallTree`, `recallKeyword`, `applyUtilityWeighting` (UFL re-rank)
  - `connection.ts` — cached SQLite connection pool (`withDb`, `closeAllConnections`); HTTP hot path reuses connections instead of open/close per call
  - `mappers.ts` — shared row-to-type mappers + `truncateText`
  - `index.ts` — barrel re-export
- `core/types.ts` — `MemoriaResult<T>` envelope, `RecallFilter`, etc.
- `core/paths.ts` — `resolveMemoriaPaths()`, `getMemoriaHome()`
- `core/utils.ts` — pure helpers (`safeDate`, `slugify`, `stableStringify`, `tokenCoverage`, `effectiveUtility`, `buildCalibration`, etc.)
- `core/recall-vector.ts` — opt-in semantic recall: spawns the `skills/memoria-vector` helper, maps prefixed ids back to authoritative local rows, RRF fusion (`LIBSQL_URL`-gated, fail-open)
- `core/source-import.ts` — raw markdown/text ingestion
- `core/wiki.ts` / `wiki-build.ts` / `wiki-query.ts` / `wiki-lint.ts` — compiled wiki pipeline (`index`/`log`/`overview` special pages, `synthesis`/`comparison` file-back, durable lint findings)
- `core/index.ts` — unified re-export (import from here, not deep paths, when adding callers)

CLI modules under `src/cli/`:
- `shared.ts` — `readSession` (Zod validator), `previewSync`
- `runtime.ts` — `getRuntimeLayout`, `deployAgentSkill` and related helpers
- `preflight.ts` — `runPreflight`
- `commands/` — one file per command (`init`, `sync`, `source`, `wiki`, `stats`, `index-cmd`, `govern`, `doctor`, `verify`, `prune`, `export`, `serve`, `preflight-cmd`, `setup`)

Three entrypoints consume `core/`:

- `src/cli.ts` — Commander CLI (`./cli`)
- `src/server.ts` — HTTP API on `node:http` (zero extra deps), default port 3917, env `MEMORIA_PORT`
- `src/sdk.ts` — `MemoriaClient` Node SDK

Adapters (`src/adapter/`) extend `BaseAdapter` to wire Memoria into specific agent runtimes (Antigravity CLI, Codex CLI, OpenCode, Claude Code).

**Every public API returns `MemoriaResult<T>`** with `evidence[]`, `confidence`, `latency_ms`. Preserve this envelope when adding new endpoints/methods.

### Persistence Layout

`MEMORIA_HOME` (defaults to repo root, overridable; `MEMORIA_DB_PATH` / `MEMORIA_SESSIONS_PATH` / `MEMORIA_CONFIG_PATH` override individual paths). SQLite is the source of truth; markdown files under `<home>/memoria/` are derived/synced views. `initDatabase()` patches older DBs in place — keep schema changes backward-compatible.

### Recall

`recall()` supports `keyword | tree | hybrid | vector` modes with an adaptive gate that skips trivial queries. Hits are ranked by relevance × time-decay (halfLife = 90 days), then down-weighted by accrued per-memory utility (UFL; no-op until a memory has enough observations). `vector` is opt-in semantic recall: `LIBSQL_URL` + the `skills/memoria-vector` helper (local embeddings, libSQL native vectors, RRF-fused with the lexical floor, fail-open — degrades to `vector_unavailable`/`vector_timeout` route modes).

**Utility feedback loop (UFL)**: every successful recall carries `meta.recall_id`; `POST /v1/recall/:id/outcome` (`{signal, utility_score?, used?, hits?}`) writes observed utility back — `hits[]` attributes it per memory (`memory_utility` table), `signal:'explicit'` is the high-fidelity host signal that overrides the lexical-reuse proxy (`effectiveUtility`). Adapters report reuse automatically. Confidence×utility calibration appears in `stats`/telemetry once outcomes exist. Telemetry rows are exposed via `recallTelemetry({ window, limit })` and `GET /v1/telemetry/recall`.

### Git-Aware Memory (issue-1)

`repo` commands observe existing git repositories **read-only** (spec + design in `docs/issues/issue-1/`): `repo add` registers identity (fingerprint is root-commit-based; shallow clones become `limited_history` and upgrade in place after unshallow), `repo sync` incrementally ingests commits/refs/tags (`git_commits`/`git_refs`/`git_scan_runs`), diffs snapshots into `git_events` (history-rewrite detection, lazy patch-id), plans deterministic commit ranges (trivial filter + important-file exception, secret masking), and writes structured summaries (`git_summary_ranges`/`git_summaries`). Summaries start as deterministic skeletons (`status='pending'`); the host agent enriches them via `repo summarize --pending` → `--submit <id>` (Zod-validated payload; HTTP `POST /v1/repos/:ref/summaries/:id`). Eligible summaries promote into the existing recall corpus (synthetic session + `DecisionMade` events → FTS) with provenance in `memory_sources` and milestones in `memory_checkpoints`; recall hits then carry `hit.source` (`{type, repository, branch?, tag?, base_sha?, head_sha, summary_id}`). Key modules: `core/git/` (git-exec allowlist, identity, scanner, change-detector, range-planner, summary-*) and `core/db/git-*.ts`. `<configPath>/config.json` (`git.*` block, Zod-validated, optional) is the repo's only config file. Non-invasive contract: only allowlisted read commands run against managed repos (`GIT_OPTIONAL_LOCKS=0`); `scripts/test-repo-noninvasive.sh` asserts byte-identical git state after the full flow. Cross-process sync concurrency is a documented v1 limitation (in-process it is serialized per repository).

## Conventions That Are Easy to Get Wrong

- **Don't rename CLI commands** without an explicit request — they are part of the agent contract. This covers both top-level commands (`init`, `sync`, `stats`, `doctor`, `verify`, `index`, `source`, `repo`, `wiki`, `govern`, `prune`, `export`, `serve`, `preflight`, `setup`) and their subcommands (`source add/list`, `repo add/list/status/sync/summarize/relocate/remove`, `wiki build/file-query/lint`, `index build`, `govern review`). Note `sync` (session import) and `repo sync` (git scan) are different commands.
- **`prune --all`** includes consolidate (90d) + stale (180d) + git-observations (90d) by default. Use `--consolidate-days` / `--stale-days` / `--git-observations-days` for custom thresholds; don't change defaults silently.
- **Schema changes** must keep older DBs readable (see existing patch pattern in `initDatabase()`); add migrations rather than breaking columns.
- **Validate at boundaries** with Zod (`unknown` → parse), not deep inside core logic.
- **DB lifecycle**: every code path that opens the DB must close it in `try/finally`.
- **Don't add tooling** (linters, formatters, test frameworks, runtime deps) unless asked — this repo deliberately stays lean. Current deps: `better-sqlite3`, `commander`, `zod`.
- **MCP/libSQL is optional**, gated by `LIBSQL_URL`. Memoria-only must remain a fully functional mode.
- **ESM imports only**. Use `node:fs/promises` for async fs and `path.join/resolve` for paths.
- **Sample files** (e.g. `examples/session.sample.json`) are consumed by both docs and tests — update all readers if the schema changes.

## Definition of Done

1. `pnpm run check` passes.
2. `pnpm run build` succeeds and `node dist/cli.mjs --help` runs.
3. For flow changes: relevant `scripts/test-*.sh` passes.
4. Touched shell scripts pass `bash -n`.
5. CLI flags/output remain consistent with existing UX.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Memoria** (1476 symbols, 2437 relationships, 118 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/Memoria/context` | Codebase overview, check index freshness |
| `gitnexus://repo/Memoria/clusters` | All functional areas |
| `gitnexus://repo/Memoria/processes` | All execution flows |
| `gitnexus://repo/Memoria/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
