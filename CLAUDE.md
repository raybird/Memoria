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

The CLI (`src/cli.ts`, ~350 lines) is a thin Commander shell. **All business logic lives in `src/core/`**, accessible to CLI, HTTP server, and SDK alike:

- `core/memoria.ts` — `MemoriaCore` class, the public API surface
- `core/db.ts` — all SQLite operations (open/close lifecycle in `try/finally`)
- `core/types.ts` — `MemoriaResult<T>` envelope, `RecallFilter`, etc.
- `core/paths.ts` — `resolveMemoriaPaths()`, `getMemoriaHome()`
- `core/source-import.ts` — raw markdown/text ingestion
- `core/wiki.ts` / `wiki-build.ts` / `wiki-query.ts` / `wiki-lint.ts` — compiled wiki pipeline (`index`/`log`/`overview` special pages, `synthesis`/`comparison` file-back, durable lint findings)
- `core/index.ts` — unified re-export (import from here, not deep paths, when adding callers)

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

- **Don't rename CLI commands** (`init`, `sync`, `stats`, `doctor`, `verify`, `index`, `source`, `wiki`, `govern`, `prune`, `export`, `serve`, `preflight`, `setup`) without an explicit request — they are part of the agent contract.
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
