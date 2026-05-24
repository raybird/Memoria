# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
bash scripts/test-bootstrap.sh              # ./cli setup self-install
bash scripts/test-adapter-runtime.sh        # adapter ESM runtime
bash scripts/test-no-clone-install.sh       # install.sh from release tarball
bash scripts/test-mcp-e2e.sh                # MCP/libSQL hybrid + incremental
bash scripts/test-wiki-ingest.sh            # raw source ingest
bash scripts/test-wiki-build.sh             # compiled wiki special pages
bash scripts/test-wiki-query-fileback.sh    # query file-back
bash scripts/test-wiki-lint.sh              # wiki governance lint
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
  - `telemetry.ts` — `logRecallTelemetry`, `queryStats`, `queryRecallTelemetry`, `queryGovernanceReview`
  - `verify.ts` — `runVerify`
  - `prune-export.ts` — `runPrune`, `exportMemory`
  - `recall.ts` — `buildMemoryIndex`, `recallTree`, `recallKeyword`
  - `mappers.ts` — shared row-to-type mappers + `truncateText`
  - `index.ts` — barrel re-export (all 32 public functions)
- `core/types.ts` — `MemoriaResult<T>` envelope, `RecallFilter`, etc.
- `core/paths.ts` — `resolveMemoriaPaths()`, `getMemoriaHome()`
- `core/utils.ts` — pure helpers (`safeDate`, `slugify`, `stableStringify`, etc.)
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

Adapters (`src/adapter/`) extend `BaseAdapter` to wire Memoria into specific agent runtimes (Gemini, OpenCode).

**Every public API returns `MemoriaResult<T>`** with `evidence[]`, `confidence`, `latency_ms`. Preserve this envelope when adding new endpoints/methods.

### Persistence Layout

`MEMORIA_HOME` (defaults to repo root, overridable; `MEMORIA_DB_PATH` / `MEMORIA_SESSIONS_PATH` / `MEMORIA_CONFIG_PATH` override individual paths). SQLite is the source of truth; markdown files under `<home>/memoria/` are derived/synced views. `initDatabase()` patches older DBs in place — keep schema changes backward-compatible.

### Recall

`recall()` supports `keyword | tree | hybrid` modes with an adaptive gate that skips trivial queries. Hits are ranked by relevance × time-decay (halfLife = 90 days). Telemetry rows are exposed via `recallTelemetry({ window, limit })` and `GET /v1/telemetry/recall`.

## Conventions That Are Easy to Get Wrong

- **Don't rename CLI commands** without an explicit request — they are part of the agent contract. This covers both top-level commands (`init`, `sync`, `stats`, `doctor`, `verify`, `index`, `source`, `wiki`, `govern`, `prune`, `export`, `serve`, `preflight`, `setup`) and their subcommands (`source add/list`, `wiki build/file-query/lint`, `index build`, `govern review`).
- **`prune --all`** includes consolidate (90d) + stale (180d) by default. Use `--consolidate-days` / `--stale-days` for custom thresholds; don't change defaults silently.
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

This project is indexed by GitNexus as **Memoria** (1453 symbols, 2207 relationships, 83 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

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
