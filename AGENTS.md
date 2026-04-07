# AGENTS.md

Guidance for coding agents operating in this repository.

## Project Snapshot

- Stack: TypeScript CLI (Node.js).
- Package manager: `pnpm` (lockfile: `pnpm-lock.yaml`).
- Entry point: `cli` -> `src/cli.ts` via `tsx`.
- Core domains: session import, SQLite persistence, markdown sync, compiled wiki maintenance.
- Main runtime dependency: `better-sqlite3`.
- Validation library: `zod`.

## Source of Truth for Commands

- `package.json` scripts
- `.github/workflows/ci.yml`
- `scripts/test-smoke.sh`

If local docs disagree with CI, follow CI.

## Environment Requirements

- Node.js `>=18` (CI runs Node 22).
- `pnpm` available on PATH.
- Optional but common: `MEMORIA_HOME` pointing at repo root.
- Optional explicit path overrides:
  - `MEMORIA_DB_PATH`
  - `MEMORIA_SESSIONS_PATH`
  - `MEMORIA_CONFIG_PATH`

## Setup Commands

- Install deps: `pnpm install`
- Run CLI in dev: `pnpm run memoria -- --help`
- Initialize memory dirs/db: `MEMORIA_HOME=$(pwd) ./cli init`

## Build, Lint, and Test Commands

There is an optional distribution build step and no dedicated ESLint/Prettier config.

- Type check (primary static check): `pnpm run check`
- Direct type check equivalent: `pnpm exec tsc --noEmit`
- Build distributable CLI artifact: `pnpm run build`
- Validate shell script syntax: `bash -n install.sh`
- Smoke/integration test: `bash scripts/test-smoke.sh`

## Single-Test Guidance (Important)

This repo currently has explicit runtime and wiki test scripts:

- `scripts/test-smoke.sh`
- `scripts/test-bootstrap.sh`
- `scripts/test-adapter-runtime.sh`
- `scripts/test-no-clone-install.sh`
- `scripts/test-mcp-e2e.sh`
- `scripts/test-wiki-ingest.sh`
- `scripts/test-wiki-build.sh`
- `scripts/test-wiki-query-fileback.sh`
- `scripts/test-wiki-lint.sh`

- Run smoke test: `bash scripts/test-smoke.sh`
- Run bootstrap/self-install test: `bash scripts/test-bootstrap.sh`
- Run adapter native ESM runtime test: `bash scripts/test-adapter-runtime.sh`
- Run no-clone install test: `bash scripts/test-no-clone-install.sh`
- Run MCP/libSQL e2e test: `bash scripts/test-mcp-e2e.sh`
- Run wiki source ingest test: `bash scripts/test-wiki-ingest.sh`
- Run wiki build test: `bash scripts/test-wiki-build.sh`
- Run wiki query file-back test: `bash scripts/test-wiki-query-fileback.sh`
- Run wiki lint test: `bash scripts/test-wiki-lint.sh`
- There is no unit-test framework (no Jest/Vitest/Pytest config present).
- For focused verification, run one CLI flow manually:
  - `TMP=$(mktemp -d)`
  - `MEMORIA_HOME="$TMP" ./cli init`
  - `MEMORIA_HOME="$TMP" ./cli sync examples/session.sample.json`

## CI Parity Checklist

Before opening PRs, mirror CI locally in this order:

1. `pnpm install`
2. `pnpm run check`
3. `pnpm run build`
4. `node dist/cli.mjs --help`
5. `bash -n install.sh`
6. `bash scripts/test-smoke.sh`
7. `bash scripts/test-bootstrap.sh`
8. `bash scripts/test-adapter-runtime.sh`
9. `bash scripts/test-no-clone-install.sh`
10. `bash scripts/test-mcp-e2e.sh`
11. `bash scripts/test-wiki-ingest.sh`
12. `bash scripts/test-wiki-build.sh`
13. `bash scripts/test-wiki-query-fileback.sh`
14. `bash scripts/test-wiki-lint.sh`

## Repository Layout

- `src/cli.ts`: CLI thin shell (~350 lines); calls `src/core/`.
- `src/core/`: Core library (types / paths / utils / db / memoria / index).
- `src/server.ts`: HTTP API server (node:http, zero extra deps).
- `src/sdk.ts`: Node.js SDK client (`MemoriaClient`).
- `cli`: executable shim (`pnpm tsx`).
- `dist/cli.mjs`: esbuild bundle (production).
- `src/core/source-import.ts`: raw source import for markdown/text inputs.
- `src/core/wiki-build.ts`: compiled wiki special-page builder.
- `src/core/wiki-query.ts`: query file-back into synthesis/comparison pages.
- `src/core/wiki-lint.ts`: wiki governance finding generation.
- `scripts/test-smoke.sh`: smoke test (CLI full flow).
- `scripts/test-mcp-e2e.sh`: MCP/libSQL hybrid + incremental sync test.
- `scripts/test-bootstrap.sh`: bootstrap test (AI Agent self-install flow).
- `scripts/test-wiki-ingest.sh`: raw source ingest + source-summary page test.
- `scripts/test-wiki-build.sh`: compiled wiki special pages test.
- `scripts/test-wiki-query-fileback.sh`: query filing test.
- `scripts/test-wiki-lint.sh`: wiki governance/lint test.
- `skills/memoria-memory-sync/SKILL.md`: Agent Skill entrypoint.
- `examples/session.sample.json`: sample input for sync flow.
- `.github/workflows/ci.yml`: canonical validation pipeline.

## Core Architecture (Phase 1)

All business logic lives in `src/core/`. The CLI is a thin commander shell.

```
src/core/
  types.ts     – MemoriaResult<T> envelope, RecallFilter, RecallHit, HealthStatus …
  paths.ts     – resolveMemoriaPaths(), getMemoriaHome()
  utils.ts     – slugify, shortHash, safeDate, resolveSessionId …
  db.ts        – all SQLite operations (init, import, sync, verify, recall, wiki state …)
  source-import.ts – raw markdown/text source import
  wiki.ts      – wiki constants + markdown render helpers
  wiki-build.ts – compiled wiki special pages (`index/log/overview`)
  wiki-query.ts – file high-value recall output back into wiki pages
  wiki-lint.ts – durable wiki lint finding generation
  memoria.ts   – MemoriaCore class (remember/recall/wiki flows/health/stats)
  index.ts     – unified re-export
```

**MemoriaCore API** (all return `MemoriaResult<T>`):
- `remember(sessionData)` – import + sync daily/decisions/skills
- `addSource(input)` – import markdown/text source and generate `source-summary`
- `listSources(filter)` – inspect imported raw sources
- `recall(filter)` – supports `keyword | tree | hybrid` retrieval plus adaptive skip for trivial queries; results are ranked by relevance × time-decay (halfLife=90 days)
- `buildWiki()` – refresh compiled wiki special pages (`index/log/overview`)
- `fileQuery(input)` – file a high-value recall result into `synthesis` or `comparison` page
- `wikiLint(options)` – generate durable wiki governance findings
- `summarizeSession(id)` – structured session + decisions + skills
- `health()` – verify DB + dirs
- `stats()` – session/event/skill counts
- `recallTelemetry({ window, limit })` – raw recall routing telemetry rows
- `governanceReview({ project, scope, limit })` – deterministic governance candidate review

## HTTP API (Phase 1)

Start with `./cli serve` (default port 3917, override via `MEMORIA_PORT`):

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/v1/health` | Health check |
| `GET`  | `/v1/stats` | Stats |
| `GET`  | `/v1/telemetry/recall` | Recall routing telemetry |
| `POST` | `/v1/remember` | Write session memory |
| `POST` | `/v1/recall` | Recall memories |
| `POST` | `/v1/sources` | Import raw source |
| `GET`  | `/v1/sources` | List raw sources |
| `POST` | `/v1/wiki/build` | Rebuild compiled wiki pages |
| `POST` | `/v1/wiki/file-query` | File query result into wiki page |
| `POST` | `/v1/wiki/lint` | Run wiki governance lint |
| `GET`  | `/v1/sessions/:id/summary` | Session summary |

All responses are `MemoriaResult<T>` JSON with `evidence[]`, `confidence`, `latency_ms`.

## Bootstrap Flow for AI Agents (Phase 1.5)

Agents can self-install Memoria without human intervention:

```bash
# 1. Clone repo
git clone https://github.com/raybird/Memoria && cd Memoria

# 2. One-shot setup (preflight → install → init → verify)
./cli setup --json

# 3. Or: setup + start server in one step
./cli setup --serve --port 3917 --json

# 4. Poll until ready (SDK)
# const client = new MemoriaClient()
# await client.waitUntilReady()
```

Machine-readable step log (JSON lines):
```
{"step":"preflight","ok":true,"ms":120}
{"step":"install","ok":true,"ms":3400}
{"step":"init","ok":true,"ms":85}
{"step":"verify","ok":true,"ms":42}
{"step":"serve","ok":true,"port":3917}
```

Preflight checks: `./cli preflight --json` → Node.js version, pnpm, disk space, write permission.

Test the bootstrap flow: `bash scripts/test-bootstrap.sh`

## Agent Runtime Quickstart

For agents that need a deterministic install-and-use path, follow this exact sequence:

1. Setup and serve:

```bash
./cli setup --serve --port 3917 --json
```

2. Wait until healthy:

```bash
curl -sf http://localhost:3917/v1/health
```

3. Write memory:

```bash
curl -sS -X POST http://localhost:3917/v1/remember \
  -H 'Content-Type: application/json' \
  -d @examples/session.sample.json
```

Optional: add `scope` to session JSON (for example `agent:main`, `user:alice`, `project:Memoria`).

4. Recall memory (`mode` supports `keyword|tree|hybrid`):

```bash
curl -sS -X POST http://localhost:3917/v1/recall \
  -H 'Content-Type: application/json' \
  -d '{"query":"TS migration","top_k":5,"mode":"hybrid","scope":"project:Memoria"}'
```

5. Observe routing quality:

```bash
curl -sS "http://localhost:3917/v1/telemetry/recall?window=P7D&limit=50"
```

6. Review governance candidates:

```bash
MEMORIA_HOME=$(pwd) ./cli govern review --json
```

7. Import raw source and refresh compiled wiki:

```bash
MEMORIA_HOME=$(pwd) ./cli source add notes/research.md
MEMORIA_HOME=$(pwd) ./cli wiki build
```

8. File a high-value query back into the wiki:

```bash
MEMORIA_HOME=$(pwd) ./cli wiki file-query \
  --query "TS CLI migration" \
  --title "TS CLI Migration Brief" \
  --kind synthesis \
  --scope project:Memoria
```

9. Run wiki governance checks:

```bash
MEMORIA_HOME=$(pwd) ./cli wiki lint --json
```

Optional enhancement (not required):

```bash
export LIBSQL_URL="file:/path/to/memory-tool.db"
bash skills/memoria-memory-sync/scripts/run-sync-with-enhancement.sh examples/session.sample.json
```

## Agent Skill and MCP Notes

- Primary skill path: `skills/memoria-memory-sync/SKILL.md`.
- Hybrid runner: `skills/memoria-memory-sync/scripts/run-sync-with-enhancement.sh`.
- MCP integration is optional and gated by `LIBSQL_URL`.
- Default MCP server launch for automation is `npx -y mcp-memory-libsql`.

## Code Style: General

- Keep changes minimal and targeted; avoid broad refactors.
- Prefer clarity over cleverness.
- Preserve existing architecture and command-line UX.
- Do not introduce new tooling unless explicitly requested.
- Avoid adding dependencies unless justified by clear need.

## Code Style: TypeScript

- TS config is strict (`"strict": true`); keep code type-safe.
- Prefer explicit narrow types for external/untrusted data.
- Use `unknown` at boundaries, then validate (current pattern: Zod).
- Keep helper functions small and single-purpose.
- Maintain existing function-oriented style (no unnecessary classes).
- Use async fs APIs from `node:fs/promises`.
- Use `path.join/resolve` for filesystem paths.

## Imports and Module Conventions

- Use ESM imports (project has `"type": "module"`).
- Keep import groups consistent with current file style:
  1. Node built-ins
  2. Third-party packages
  3. Local modules (if added)
- Keep side-effect imports explicit and rare.

## Naming Conventions

- Functions/variables: `camelCase`.
- Types/interfaces/type aliases: `PascalCase`.
- Constants: `UPPER_SNAKE_CASE` only for true constants; otherwise `camelCase`.
- Filenames: existing style is lowercase with separators as needed.
- IDs/slugs: sanitize before filesystem usage.

## Error Handling and Reliability

- Validate external input before use (JSON parse + schema parse).
- Throw informative `Error` messages for user-facing failures.
- Use `try/finally` for DB open/close lifecycle.
- Avoid swallowing errors silently; explicit fallbacks are acceptable.
- Keep CLI exit behavior consistent (`run().catch(...); process.exit(1)`).

## SQLite and Data Handling

- Keep schema changes backward-compatible unless requested.
- Prefer prepared statements for inserts/queries.
- Preserve current upsert semantics (`INSERT OR REPLACE`).
- Serialize structured fields with `JSON.stringify` before persistence.
- Be careful with timestamp parsing; use safe date fallback pattern.
- Preserve backward-compatible schema upgrades (`initDatabase()` currently patches older DBs).

## File and Markdown Output Rules

- Ensure directories exist before writing.
- Keep deterministic, sanitized filenames (`slugify`/sanitize pattern).
- Preserve markdown document section structure when extending templates.
- Use UTF-8 when writing text files.

## Shell Style in This Repo

- Shell scripts should use `set -euo pipefail` when practical.
- Quote variable expansions in shell paths.

## What Not to Change Implicitly

- Do not rename CLI commands (`init`, `sync`, `stats`, `doctor`, `verify`, `index`, `govern`, `prune`, `export`) without request.
- Do not change persisted table names/columns without migration plan.
- `prune --all` includes consolidate (90d) and stale (180d) by default. Use `--consolidate-days` or `--stale-days` for custom thresholds.
- Do not alter sample file formats unless all readers are updated.

## Agent Workflow Recommendations

- Read `package.json` and CI workflow before coding.
- Implement smallest viable change.
- Run relevant checks from the CI parity checklist.
- Update docs when command behavior or flags change.

## Cursor and Copilot Rules

- `.cursor/rules/`: not present at time of writing.
- `.cursorrules`: not present at time of writing.
- `.github/copilot-instructions.md`: not present at time of writing.
- If these files are later added, treat them as higher-priority agent rules.

## Definition of Done for Agent Changes

- Code compiles with `pnpm run check`.
- Smoke test passes (`bash scripts/test-smoke.sh`) for flow changes.
- Script syntax remains valid for touched shell files.
- Behavior and output remain consistent with existing CLI expectations.
