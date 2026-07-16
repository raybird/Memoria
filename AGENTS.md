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
- `scripts/test-migrations.sh`
- `scripts/test-prune.sh`
- `scripts/test-utility-ranking.sh`
- `scripts/test-bootstrap.sh`
- `scripts/test-adapter-runtime.sh`
- `scripts/test-utility-shadow.sh`
- `scripts/test-no-clone-install.sh`
- `scripts/test-installer-platform.sh`
- `scripts/test-npm-install.sh`
- `scripts/test-service-manager.sh`
- `scripts/test-mcp-e2e.sh`
- `scripts/test-http-api.sh`
- `scripts/test-vector-recall.sh`
- `scripts/test-wiki-ingest.sh`
- `scripts/test-wiki-build.sh`
- `scripts/test-wiki-query-fileback.sh`
- `scripts/test-wiki-lint.sh`
- `scripts/test-repo-git-exec.sh`
- `scripts/test-repo-registry.sh`
- `scripts/test-repo-sync.sh`
- `scripts/test-repo-events.sh`
- `scripts/test-repo-summary.sh`
- `scripts/test-repo-promotion.sh`
- `scripts/test-repo-edge.sh`
- `scripts/test-repo-noninvasive.sh`

- Run smoke test: `bash scripts/test-smoke.sh`
- Run schema migration regression test: `bash scripts/test-migrations.sh`
- Run prune deletion path test: `bash scripts/test-prune.sh`
- Run utility-weighted ranking test (UFL Phase 3): `bash scripts/test-utility-ranking.sh`
- Run bootstrap/self-install test: `bash scripts/test-bootstrap.sh`
- Run adapter native ESM runtime test: `bash scripts/test-adapter-runtime.sh`
- Run utility-shadow spike plumbing test: `bash scripts/test-utility-shadow.sh`
- Run no-clone install test: `bash scripts/test-no-clone-install.sh`
- Run installer platform routing test: `bash scripts/test-installer-platform.sh`
- Run packed npm install test: `bash scripts/test-npm-install.sh`
- Run macOS/Linux user service lifecycle test: `bash scripts/test-service-manager.sh`
- Run MCP/libSQL e2e test: `bash scripts/test-mcp-e2e.sh`
- Run HTTP API contract test: `bash scripts/test-http-api.sh`
- Run semantic vector recall contract test: `bash scripts/test-vector-recall.sh`
- Run wiki source ingest test: `bash scripts/test-wiki-ingest.sh`
- Run wiki build test: `bash scripts/test-wiki-build.sh`
- Run wiki query file-back test: `bash scripts/test-wiki-query-fileback.sh`
- Run wiki lint test: `bash scripts/test-wiki-lint.sh`
- Run git read-only exec layer test: `bash scripts/test-repo-git-exec.sh`
- Run repository registry test: `bash scripts/test-repo-registry.sh`
- Run incremental git scan test: `bash scripts/test-repo-sync.sh`
- Run git events / dry-run / rewrite test: `bash scripts/test-repo-events.sh`
- Run summary pipeline test: `bash scripts/test-repo-summary.sh`
- Run promotion + recall provenance + HTTP repos test: `bash scripts/test-repo-promotion.sh`
- Run shallow/worktree/prune edge test: `bash scripts/test-repo-edge.sh`
- Run non-invasive acceptance test: `bash scripts/test-repo-noninvasive.sh`
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
7. `bash scripts/test-migrations.sh`
8. `bash scripts/test-prune.sh`
9. `bash scripts/test-utility-ranking.sh`
10. `bash scripts/test-bootstrap.sh`
11. `bash scripts/test-adapter-runtime.sh`
12. `bash scripts/test-utility-shadow.sh`
13. `bash scripts/test-no-clone-install.sh`
14. `bash scripts/test-mcp-e2e.sh`
15. `bash scripts/test-http-api.sh`
16. `bash scripts/test-vector-recall.sh`
17. `bash scripts/test-wiki-ingest.sh`
18. `bash scripts/test-wiki-build.sh`
19. `bash scripts/test-wiki-query-fileback.sh`
20. `bash scripts/test-wiki-lint.sh`
21. `bash scripts/test-repo-git-exec.sh`
22. `bash scripts/test-repo-registry.sh`
23. `bash scripts/test-repo-sync.sh`
24. `bash scripts/test-repo-events.sh`
25. `bash scripts/test-repo-summary.sh`
26. `bash scripts/test-repo-promotion.sh`
27. `bash scripts/test-repo-edge.sh`
28. `bash scripts/test-repo-noninvasive.sh`
29. `bash scripts/test-installer-platform.sh` (all Linux/macOS x64/arm64 URL routes)
30. `bash scripts/test-npm-install.sh` (also runs on macOS in its own CI job)
31. `bash scripts/test-service-manager.sh` (mocked systemd/launchd lifecycle; also runs on macOS)

## Repository Layout

- `src/cli.ts`: CLI registration shell (~50 lines); imports each command module and calls its `register*Command()`.
- `src/cli/`: Per-command modules + shared helpers (`shared.ts`, `runtime.ts`, `preflight.ts`, `commands/`).
- `src/core/`: Core library (types / paths / utils / db/ / memoria / index).
- `src/server.ts`: HTTP API server (node:http, zero extra deps).
- `src/sdk.ts`: Node.js SDK client (`MemoriaClient`).
- `cli`: executable shim (`pnpm tsx`).
- `dist/cli.mjs`: esbuild bundle (production).
- `src/core/source-import.ts`: raw source import for markdown/text inputs.
- `src/core/wiki-build.ts`: compiled wiki special-page builder.
- `src/core/wiki-query.ts`: query file-back into synthesis/comparison pages.
- `src/core/wiki-lint.ts`: wiki governance finding generation.
- `src/core/config.ts`: `<configPath>/config.json` loader (`git.*` block, Zod-validated, optional).
- `src/core/git/`: Git-Aware Memory read layer — `git-exec.ts` (runtime allowlist), `identity.ts` (fingerprint), `scanner.ts`, `change-detector.ts`, `range-planner.ts`, `summary-context.ts`, `summary-generator.ts`, `summary-pipeline.ts`, `summary-schema.ts`, `secret-filter.ts`, `host.ts`.
- `src/core/db/git-repo.ts` / `git-scan.ts` / `git-summary.ts` / `git-promote.ts`: registry, scan persistence, summaries, memory promotion + `lookupGitSources`.
- `scripts/test-smoke.sh`: smoke test (CLI full flow).
- `scripts/test-migrations.sh`: schema migration upgrade regression on a populated pre-migration DB.
- `scripts/test-prune.sh`: destructive prune path regression — consolidate/stale/dedupe delete exactly the right rows (dry-run deletes nothing); utility-weighted retention spares high-utility memories.
- `scripts/test-utility-ranking.sh`: UFL Phase 3 — utility-weighted recall ranking (zero-data stable / below-threshold unchanged / threshold flips ordering / explicit overrides reuse).
- `scripts/test-http-api.sh`: HTTP endpoint contract test (sources / wiki / session summary / recall outcome write-back + calibration + error paths).
- `scripts/test-mcp-e2e.sh`: MCP/libSQL hybrid + incremental sync test.
- `scripts/test-vector-recall.sh`: semantic recall (`mode:'vector'`) contract — embed→store→top_k→map→fuse plumbing, degradation matrix, stats counters (stub provider; `MEMORIA_VECTOR_E2E_REAL=1` adds a live-model assertion).
- `scripts/test-bootstrap.sh`: bootstrap test (AI Agent self-install flow).
- `scripts/test-installer-platform.sh`: installer release URL routing contract for Linux/macOS on x64/arm64.
- `scripts/test-npm-install.sh`: packs and installs the published npm layout, then verifies installed mode and the deployed skill launcher (Ubuntu/macOS CI).
- `scripts/test-service-manager.sh`: mock-based Linux systemd user + macOS LaunchAgent definition/lifecycle test.
- `scripts/test-wiki-ingest.sh`: raw source ingest + source-summary page test.
- `scripts/test-wiki-build.sh`: compiled wiki special pages test.
- `scripts/test-wiki-query-fileback.sh`: query filing test.
- `scripts/test-wiki-lint.sh`: wiki governance/lint test.
- `skills/memoria-memory-sync/SKILL.md`: Agent Skill entrypoint.
- `skills/memoria-vector/`: optional semantic-recall helper (embedding + libSQL native vectors; own npm deps, spawned by core — never imported).
- `examples/session.sample.json`: sample input for sync flow.
- `.github/workflows/ci.yml`: canonical validation pipeline.

## Core Architecture (Phase 1)

All business logic lives in `src/core/`. The CLI is a thin commander registration shell.

```
src/core/
  types.ts     – MemoriaResult<T> envelope, RecallFilter, RecallHit, HealthStatus …
  paths.ts     – resolveMemoriaPaths(), getMemoriaHome()
  utils.ts     – slugify, shortHash, safeDate, resolveSessionId …
  db/          – SQLite operations split by domain (each file owns one concern):
    schema.ts      – initDatabase (DDL + migrations)
    session.ts     – importSession, listRecentSessions, querySessionSummary
    source.ts      – upsertSourceRecord, listSourceRecords
    wiki.ts        – wiki pages / links / artifacts (9 functions)
    lint.ts        – wiki lint runs & findings (4 functions)
    sync.ts        – syncDailyNote, extractDecisions, extractSkills
    telemetry.ts   – logRecallTelemetry, recordRecallOutcome (UFL write-back + per-memory attribution), queryStats (incl. confidence×utility calibration), queryRecallTelemetry, queryGovernanceReview
    verify.ts      – runVerify
    prune-export.ts – runPrune (utility-weighted retention), exportMemory
    recall.ts      – buildMemoryIndex, recallTree, recallKeyword, applyUtilityWeighting (UFL re-rank)
    git-repo.ts    – repository registry (registerRepository, findRepository, relocate/remove)
    git-scan.ts    – incremental scan persistence (commits/refs/scan runs/events)
    git-summary.ts – summary ranges + summaries (idempotent upserts, agent write-back)
    git-promote.ts – memory promotion + checkpoints + lookupGitSources (recall provenance)
    connection.ts  – cached SQLite connection pool (withDb, closeAllConnections); HTTP hot path reuses connections
    mappers.ts     – shared row-to-type mappers + truncateText
    index.ts       – barrel re-export
  git/           – Git-Aware Memory read layer (allowlisted git exec, identity, scanner,
                   change detector, deterministic range planner, summary context/generator/
                   pipeline, secret filter, host id)
  config.ts      – config.json loader (git.* block, Zod, optional)
  recall-vector.ts – opt-in semantic recall: spawns skills/memoria-vector helper, maps prefixed ids to authoritative local rows, RRF fusion (fail-open, LIBSQL_URL-gated)
  source-import.ts – raw markdown/text source import
  wiki.ts      – wiki constants + markdown render helpers
  wiki-build.ts – compiled wiki special pages (`index/log/overview`)
  wiki-query.ts – file high-value recall output back into wiki pages
  wiki-lint.ts – durable wiki lint finding generation
  memoria.ts   – MemoriaCore class (remember/recall/wiki flows/health/stats)
  index.ts     – unified re-export

src/cli/
  shared.ts    – readSession (Zod validator), previewSync
  runtime.ts   – getRuntimeLayout, deployAgentSkill, related helpers
  preflight.ts – runPreflight
  commands/    – one file per command (init, sync, source, wiki, stats,
                 index-cmd, govern, doctor, verify, prune, export,
                 serve, preflight-cmd, setup)
```

**MemoriaCore API** (all return `MemoriaResult<T>`):
- `remember(sessionData)` – import + sync daily/decisions/skills
- `addSource(input)` – import markdown/text source and generate `source-summary`
- `listSources(filter)` – inspect imported raw sources
- `recall(filter)` – supports `keyword | tree | hybrid | vector` retrieval plus adaptive skip for trivial queries; results are ranked by relevance × time-decay (halfLife=90 days), then down-weighted by accrued per-memory utility (UFL); success meta carries a `recall_id` for utility write-back. `vector` is opt-in semantic recall (LIBSQL_URL + `skills/memoria-vector`; degrades to lexical, fail-open)
- `recordRecallOutcome(recallId, outcome)` – UFL write-back: `{signal, utility_score?, used?, hits?}`; `hits[]` attributes utility per memory; `signal:'explicit'` is the high-fidelity host signal that overrides the reuse proxy
- `buildWiki()` – refresh compiled wiki special pages (`index/log/overview`)
- `fileQuery(input)` – file a high-value recall result into `synthesis` or `comparison` page
- `wikiLint(options)` – generate durable wiki governance findings
- `summarizeSession(id)` – structured session + decisions + skills
- `health()` – verify DB + dirs
- `stats()` – session/event/skill counts
- `recallTelemetry({ window, limit })` – raw recall routing telemetry rows
- `governanceReview({ project, scope, limit })` – deterministic governance candidate review
- `repoAdd(input)` / `repoList()` / `repoStatus(ref)` / `repoRelocate(ref, path)` / `repoRemove(ref, opts)` – git repository registry (read-only observation; fingerprint identity)
- `repoSync(ref, opts)` – incremental scan → events → deterministic summaries → promotion (`dryRun` writes nothing; serialized per repository in-process)
- `repoSummarize(ref, opts)` – branch/range/merge/tag summaries; `promote` forces promotion
- `repoPendingSummaries(ref)` / `repoSubmitSummary(ref, summaryId, payload)` – agent enrichment loop (deterministic skeleton → validated write-back → auto-promotion); recall hits from promoted summaries carry `hit.source`

## HTTP API (Phase 1)

Start with `./cli serve` (default port 3917, override via `MEMORIA_PORT`):

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/v1/health` | Health check |
| `GET`  | `/v1/stats` | Stats |
| `GET`  | `/v1/telemetry/recall` | Recall routing telemetry + confidence×utility calibration |
| `POST` | `/v1/remember` | Write session memory |
| `POST` | `/v1/recall` | Recall memories (`mode`: `keyword\|tree\|hybrid\|vector`) |
| `POST` | `/v1/recall/:id/outcome` | UFL utility write-back (`{signal, utility_score?, used?, hits?}`) |
| `POST` | `/v1/sources` | Import raw source |
| `GET`  | `/v1/sources` | List raw sources |
| `POST` | `/v1/wiki/build` | Rebuild compiled wiki pages |
| `POST` | `/v1/wiki/file-query` | File query result into wiki page |
| `POST` | `/v1/wiki/lint` | Run wiki governance lint |
| `GET`  | `/v1/sessions/:id/summary` | Session summary |
| `POST` | `/v1/repos` | Register a git repository for read-only observation (`{path, name?, ...}`) |
| `GET`  | `/v1/repos` | List observed repositories |
| `GET`  | `/v1/repos/:ref/status` | Registry + live git state (`:ref` = id, name, or path) |
| `POST` | `/v1/repos/:ref/sync` | Incremental scan (`{generate_summaries?, dry_run?, force_summary?, from?, to?}`) |
| `POST` | `/v1/repos/:ref/summarize` | Summarize branch/range/merge/tag or pending events |
| `GET`  | `/v1/repos/:ref/summaries/pending` | Summary requests awaiting agent enrichment |
| `POST` | `/v1/repos/:ref/summaries/:summaryId` | Agent write-back of a structured summary payload |

All responses are `MemoriaResult<T>` JSON with `evidence[]`, `confidence`, `latency_ms`.
Recall hits promoted from git summaries additionally carry `hit.source` (`{type, repository, branch?, tag?, base_sha?, head_sha, summary_id}`).

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

4. Recall memory (`mode` supports `keyword|tree|hybrid|vector`; `vector` needs `LIBSQL_URL` + the `skills/memoria-vector` helper and degrades to lexical otherwise):

```bash
curl -sS -X POST http://localhost:3917/v1/recall \
  -H 'Content-Type: application/json' \
  -d '{"query":"TS migration","top_k":5,"mode":"hybrid","scope":"project:Memoria"}'
```

4b. Report recall utility back (UFL — closes the loop; adapters do this automatically):

```bash
curl -sS -X POST http://localhost:3917/v1/recall/<recall_id>/outcome \
  -H 'Content-Type: application/json' \
  -d '{"signal":"explicit","used":true}'
```

5. Observe routing quality (includes confidence×utility calibration once outcomes exist):

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
