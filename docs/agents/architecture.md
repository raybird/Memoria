# Architecture and Memory Contracts

Last verified: 2026-10-23 against v1.31.1 source and the shared agent-entry migration. Paths below are repository-relative.

Read when changing core modules, recall, markers, brief generation, Git memory or their downstream contracts. Common development rules and validation commands live in [AGENTS.md](../../AGENTS.md).

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
- `core/paths.ts` — `resolveMemoriaPaths()`, `resolveMemoriaHomeInfo()` (`MemoriaHomeSource`: `env` > `detected` > `global-config` > `fallback`), `getMemoriaHome()`
- `core/install-settings.ts` — user-level `install.json` persistence (`defaultDataRoot`, per-root local vector settings, `applyEffectiveVectorEnv`, `assertIngestDbPathMatchesRoot`; never persists `LIBSQL_AUTH_TOKEN`)
- `core/utils.ts` — pure helpers (`safeDate`, `slugify`, `stableStringify`, `tokenCoverage`, `effectiveUtility`, `buildCalibration`, etc.)
- `core/recall-vector.ts` — opt-in semantic recall: spawns the `skills/memoria-vector` helper, maps prefixed ids back to authoritative local rows, RRF fusion (`LIBSQL_URL`-gated, fail-open). The helper loads its own deps through `skills/memoria-vector/deps.mjs` — sibling `node_modules` first, else the user cache `setup --vector` fills, keyed by the helper's lockfile hash (issue-25); doctor asks `node deps.mjs` rather than re-deriving the hash
- `core/source-import.ts` — raw markdown/text ingestion
- `core/wiki.ts` / `wiki-build.ts` / `wiki-query.ts` / `wiki-lint.ts` — compiled wiki pipeline (`index`/`log`/`overview` special pages, `synthesis`/`comparison` file-back, durable lint findings)
- `core/index.ts` — unified re-export (import from here, not deep paths, when adding callers)

CLI modules under `src/cli/`:
- `shared.ts` — `readSession` (Zod validator), `previewSync`
- `runtime.ts` — `getRuntimeLayout`, `deployAgentSkill` (`HOST_AGENTS`: `claude-code`, `codex`), `parseAgentFlag`, `installVectorDeps` and related helpers
- `agent-integration.ts` — managed block (`<!-- memoria:managed:start -->` ... `<!-- memoria:managed:end -->`) upsert for `AGENTS.md` and `CLAUDE.md`, pre-write safety check and backups under `<dataRoot>/.agents/instruction-backups/`
- `setup-plan.ts` — interactive onboarding prompts (`promptSetupChoices`), `buildSetupPlan`, `assertSetupPlanSafe`, `runFullVectorIngest` and isolated vector readiness verification (`verifyVectorReadiness`)
- `preflight.ts` — `runPreflight`
- `commands/` — one file per command (`init`, `sync`, `recall`, `remember`, `feedback`, `brief`, `source`, `wiki`, `stats`, `index-cmd`, `govern`, `doctor`, `verify`, `prune`, `export`, `serve`, `preflight-cmd`, `setup`)

Three entrypoints consume `core/`:

- `src/cli.ts` — Commander CLI (`./cli`)
- `src/server.ts` — HTTP API on `node:http` (zero extra deps), default port 3917, env `MEMORIA_PORT`
- `src/sdk.ts` — `MemoriaClient` Node SDK

Adapters (`src/adapter/`) extend `BaseAdapter` to wire Memoria into specific agent runtimes (Antigravity CLI, Codex CLI, OpenCode, Claude Code).

**Every public API returns `MemoriaResult<T>`** with `evidence[]`, `confidence`, `latency_ms`. Preserve this envelope when adding new endpoints/methods. `confidence` is `number | null` (issue-9) — `null` means "this route cannot judge match quality", never "poor match"; recall also stamps `confidence_basis` so callers don't infer the scale from `route_mode`.

### Persistence Layout

`MEMORIA_HOME` (defaults to repo root, overridable; `MEMORIA_DB_PATH` / `MEMORIA_SESSIONS_PATH` / `MEMORIA_CONFIG_PATH` override individual paths). SQLite is the source of truth; markdown files under `<home>/knowledge/` (`Daily`, `Decisions`, `Skills`, `Sources`, the compiled wiki, `BRIEF.md`) are derived/synced views. `initDatabase()` patches older DBs in place — keep schema changes backward-compatible.

### Recall

`recall()` supports `keyword | tree | hybrid | vector` modes with an adaptive gate that skips trivial queries. Hits are ranked by relevance × time-decay (halfLife = 90 days), then down-weighted by accrued per-memory utility (UFL; no-op until a memory has enough observations). `vector` is opt-in semantic recall: `LIBSQL_URL` + the `skills/memoria-vector` helper (local embeddings, libSQL native vectors, RRF-fused with the lexical floor, fail-open — degrades to `vector_unavailable`/`vector_timeout` route modes).

**`memory_nodes` is a COPY, not a view, and the index builder only ever adds** — it selects sessions `NOT IN (SELECT session_id FROM memory_node_sources)`, unconditionally (`--session-id` does not override it). So the tree path serves `memory_nodes.summary`, which was snapshotted at index time: rewriting `sessions.summary` in place is picked up by keyword recall immediately (FTS is trigger-maintained) and by `tree` **never**, and re-running `index build` does not repair it — the session counts as already indexed and is skipped, reporting `sessionsConsidered: 0`, which looks like "nothing to do". Anything that rewrites session text (backfill, migration, repair script) must invalidate the index itself — delete that session's `memory_node_sources` rows and re-run `index build --session-id`, which then upserts the node with the new text. Do **not** also delete the node: `parent_id` is self-referencing, so that hits `FOREIGN KEY constraint failed`, and the upsert makes it unnecessary. There is no `--rebuild` and no change detection. See `docs/OPERATIONS.md` → *Tree Index Notes* for the procedure and the real 900-memory backfill this cost.

**`relevance` is a LEXICAL measure, and semantic hits deliberately have none** (issue-9). `RecallHit.relevance` is query-token coverage; a hit only the vector index found is exactly the case where that is meaningless (the query paraphrases instead of quoting), so `VectorRow.relevance` is typed `never` — the compiler, not a comment, keeps a literal score off that path. `meta.confidence` follows the top hit: a number when it has `relevance`, `null` when it doesn't. Do not "fix" the null by substituting the RRF fused score — that is a ~0.016-scale rank artifact, not a 0–1 quality, and e5 cosine is range-compressed (0.017–0.049 between rank 1 and 2), which is why fusion ranks by position in the first place.

**CLI access (issue-4 Phase 1)**: `memoria recall <query>`, `memoria remember <text>` and `memoria feedback <recall_id>` are the CLI counterparts of `POST /v1/recall`, `/v1/remember` and `/v1/recall/:id/outcome` — they exist because a skill-style deployment has no server running. `remember` writes ONE atomic note (a synthetic session + one `DecisionMade`/`SkillLearned` event, provenance `source_type='cli_note'`); its ids are content fingerprints, so an identical re-run is a no-op rather than a rewrite. Human-readable `recall` output prints `relevance` (0–1), not the raw bm25-derived `score` that drives ordering; `--json` carries the full envelope including `meta.recall_id`.

**Long-term memory semantics (issue-5)**: one sparse side table `memory_attributes` (migration 14) keyed by `ref_id` — the same id space as `memory_utility` (a `RecallHit.id`, i.e. a session or event id) — carries three markers, each with one consumer:

| marker | set by | effect |
|---|---|---|
| `retention='durable'` | `remember --durable`, `mark <ref> --durable` | time-decay is undone at recall (score ÷ its own decay factor), the memory is spared by `prune --stale-days`, **and** it is pinned in `brief` (issue-17) — listed in its own block, exempt from the `--days` window and `topK`, so severity stops competing with recency |
| `superseded_by` | `remember --supersedes <ref>` | dropped from recall **and from `brief`** by default; `--include-superseded` (HTTP `include_superseded`) brings it back with the field attached (no such flag on `brief` — a derived view that gets auto-loaded must show one version). Data is never deleted and `export` never applies the filter |
| `sensitivity='private'` | `remember --sensitivity private`, `mark <ref> --sensitivity private` | `export --redact` replaces known entities (repository names, project tags) with deterministic code names |

Two rules to preserve when touching this: **(1) zero markers must stay byte-identical** — every reader probes the table first and returns input untouched when nothing is marked (the discipline `applyUtilityWeighting` set); **(2) `applyMemoryAttributes` runs BEFORE `applyUtilityWeighting`** so utility stays the final arbiter and a mis-marked durable memory can still be pushed down by poor observed utility. Re-running `remember` with identical text applies markers without rewriting — that is how a note marks **itself**. It structurally cannot reach a git-promoted decision, whose id is `gitdec-<summary>-<n>` and which no note text produces, so the memories most worth pinning were the ones nothing could mark. **`memoria mark <refId>` (issue-17) is the surface for marking any existing memory**; it verifies the ref names something first, for the same reason `--supersedes` does — a marker on a ref that names nothing is a silent no-op that still reads as success.

**Context injection without hooks (issue-4 Phase 2)**: `memoria brief` compiles recent decisions + high-utility memories (UFL) + per-repository state into `<knowledge>/BRIEF.md`, which shared `AGENTS.md` instructions tell the agent to read. A `CLAUDE.md` can import `@AGENTS.md` and the generated brief for launch-time context; see `docs/OPERATIONS.md` → Context injection via BRIEF.md. It is a **derived view**: read-only, whole-file overwrite on every run, never a source of truth. Generation stays manual (Q3) — no write path triggers it.

**Brief scope and pinning (issue-17)**: the recent-decisions block ranks by `timestamp`, never by severity — `impact_level` never entered it, and could not have: `git-promote.ts:90` hardcodes `'high'` and `memoria.ts:371` hardcodes `'medium'`, so that field records which code path wrote a memory, not anyone's judgement. Severity now rides on `retention='durable'` instead, surfaced as a **pinned block that never rotates out**. `brief` also resolves the **cwd** to a registered repository and writes `<knowledge>/BRIEF-<project>.md` scoped to it — one global file cannot hold a cwd-filtered result when generation is manual and `CLAUDE.md` `@`-imports a fixed path, because whoever ran it last would decide what every project sees. A memory whose `project` is **not** a registered repository name is environment-class and rides along into every project's brief; that classification is derived, so `brief` reports its count on every run and the number moving is how the reclassification stays visible. `--global` restores the pre-issue-17 single-file behaviour; an explicit `--project` still writes `BRIEF.md`, so existing callers are untouched.

**Brief allocation**: `allocateDecisions` deals the recent-decisions slots one per project, most recently active first, because a fixed per-project cap of 2 or 3 still left only 4–5 of 10 active projects visible on real data; a single project reduces to the newest `topK`. `totals.decisions_in_window` counts the whole window, excluding pinned and superseded memories. The high-utility block needs `BRIEF_UTILITY_MIN_OBS` (2) observations, stricter than recall's `EXPLICIT_UTILITY_MIN_OBS`, since a brief entry claims sustained value; it skips pinned memories, merges a git summary with its decisions, and filters scope before the `topK` cut. Pinned text keeps up to `PINNED_SNIPPET_MAX` characters because these lines often carry the command that makes the rule usable.

**Utility feedback loop (UFL)**: every successful recall carries `meta.recall_id`; `POST /v1/recall/:id/outcome` (`{signal, utility_score?, used?, hits?}`) writes observed utility back — `hits[]` attributes it per memory (`memory_utility` table), `signal:'explicit'` is the high-fidelity host signal that overrides the lexical-reuse proxy (`effectiveUtility`). Adapters report reuse automatically. Confidence×utility calibration appears in `stats`/telemetry once outcomes exist, alongside `routeUtility` — mean observed utility grouped by `route_mode` with `uplift` between the top two routes, which is how "does semantic recall beat lexical?" gets answered from data rather than argued. Both blocks are additive: absent until an outcome exists. Telemetry rows are exposed via `recallTelemetry({ window, limit })` and `GET /v1/telemetry/recall`.

### Git-Aware Memory (issue-1)

`repo` commands observe existing git repositories **read-only** (spec + design in `docs/issues/issue-1/`): `repo add` registers identity (fingerprint is root-commit-based; shallow clones become `limited_history` and upgrade in place after unshallow), `repo sync` incrementally ingests commits/refs/tags (`git_commits`/`git_refs`/`git_scan_runs`), diffs snapshots into `git_events` (history-rewrite detection, lazy patch-id), plans deterministic commit ranges (trivial filter + important-file exception, secret masking), and writes structured summaries (`git_summary_ranges`/`git_summaries`). Summaries start as deterministic skeletons (`status='pending'`); the host agent enriches them via `repo summarize --pending` → `--submit <id>` (Zod-validated payload; HTTP `POST /v1/repos/:ref/summaries/:id`). A skeleton nobody will enrich — typically a teammate's merge in a team repo — is `--dismiss <id>`'d or batch `--dismiss-pending --type merge,release`'d to `status='dismissed'` (issue-21): it leaves brief's 待增強 count (shown as 已略過 instead), `isPromotable` rejects every status but `enriched`, and a later `--submit` still flips it to enriched. Only pending rows that are not yet in recall move — dismissing an enriched summary, or a pending one already force-promoted, is an error (the batch form skips the latter and reports `skipped_promoted`). Explicit `repo summarize --promote` stays the one override: it bypasses the gate and can still promote a dismissed summary. Eligible summaries promote into the existing recall corpus (synthetic session + `DecisionMade` events → FTS) with provenance in `memory_sources` and milestones in `memory_checkpoints`; recall hits then carry `hit.source` (`{type, repository, branch?, tag?, base_sha?, head_sha, summary_id}`). Key modules: `core/git/` (git-exec allowlist, identity, scanner, change-detector, range-planner, summary-*) and `core/db/git-*.ts`. `<configPath>/config.json` (`git.*` block, Zod-validated, optional) is the repo's only config file. Non-invasive contract: only allowlisted read commands run against managed repos (`GIT_OPTIONAL_LOCKS=0`); `scripts/test-repo-noninvasive.sh` asserts byte-identical git state after the full flow. Cross-process sync concurrency is a documented v1 limitation (in-process it is serialized per repository).

### Local memory UI (issue-30)

`src/ui/app.ts` is the browser-only workspace; `style.css` owns product tokens, themes and responsive layout. `src/ui/router.ts` is a separate loopback/Host/Origin guarded read-only router enabled by `serve --ui`. It calls public Core `listMemories`, `getMemory`, `memoryFacets`, `searchMemories` and `brief`; browser code imports Core types only. `src/core/db/memory-browser.ts` reads original sessions/events with optional marker/repository/provenance tables and no migrations. Search scoping/aggregation belongs to Core, not the HTTP boundary.

`brief` and `recall` accept an optional second `{initialize:false}` argument for already initialized UI roots; existing callers retain initialization by default. UI search allows recall telemetry but never utility feedback. `scripts/build.mjs` embeds the browser bundle and CSS via `src/ui/assets.ts`; source mode uses the existing esbuild dev dependency, production has no esbuild dependency. List counts identify event/session types, never vector counts.
