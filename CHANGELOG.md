# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Fixed
- **`doctor` now says when it *skipped* the embedder probe instead of omitting the line** (issue-12 follow-up). v1.26.0 declined to probe an overridden helper's `node_modules` — correctly, since a helper bundled into someone else's image has a dependency layout we cannot assume, and guessing would manufacture a failure out of a working setup. But it expressed that by printing nothing, and an absent line reads as "nothing to report" rather than "not checked". The gap lands on exactly the wrong people: whoever sets `MEMORIA_VECTOR_RECALL_CMD` is the most likely to be missing the embedder, and they were the one group getting no answer and no hint that a question had been skipped. Found by running the shipped v1.26.0 against a real environment, where the whole check silently vanished. The probe still does not run — the fix is to report the skip (`vector embedder: not checked (helper overridden…)`, passing, since an override is not by itself unhealthy), which is the same no-silent-caps rule the context-truncation paths follow. `VectorLayerReport` gains `embedderUnknownReason` (`overridden_helper` | `provider_needs_no_embedder` | `helper_unresolved`) so the reason for a `null` is data rather than something the renderer re-derives; the addition is backward-compatible.

## [1.26.0] - 2026-08-13

### Added
- **`doctor` reports the optional vector layer** (issue-12). It was six path-existence checks, and semantic recall — the piece most likely to break across an upgrade or a redeploy — was not among them. That matters because every failure on that path is fail-open by design: a missing helper or a missing embedding backend degrades to lexical results, still answers `ok:true`, and leaves `route_mode` as the only clue. New checks cover whether the layer is enabled, whether the helper resolves, and whether `@huggingface/transformers` is present when the local provider is in use; each failure carries a `fix` naming the actual cause (`vector_unavailable` for the first, `--omit=dev` / `NODE_ENV=production` for the second). **An unset `LIBSQL_URL` passes** and reads as `not enabled` — `ok` is `checks.every(...)`, so failing an opt-in feature that was never opted into would hand a red light to every user who does not use semantic recall, which trains people to ignore doctor and is worse than not checking. (Same judgement as issue-7's on `verify`; `scripts/test-no-clone-install.sh` already asserted `checks.every(ok)` on an install with no vector layer, so that existing assertion now guards this boundary.) The diagnosis lives in `core/recall-vector.ts` as `inspectVectorLayer()`, next to the resolution it reports on — a second copy of the search order in a diagnostic would drift and then confidently describe a helper that recall never loads. `DoctorCheck` is unchanged and `--json` stays backward-compatible: "not enabled" is expressed as `ok:true` with an explanatory `value`, not a new state. Also fixes a gap the spec had missed — `resolveHelperScript()` returns `MEMORIA_VECTOR_RECALL_CMD` verbatim without probing it (the caller applies `existsSync`), so a typo'd override would have been reported as a healthy helper; `inspectVectorLayer` repeats the existence check. An overridden helper's `node_modules` is deliberately **not** probed — it may be a copy bundled into someone else's image — and the override is printed on its own line so it is clear which helper was diagnosed.

### Fixed
- **The release tarball now ships `skills/memoria-vector`** (issue-10). `package-release-artifacts.sh` copied only `memoria-memory-sync`, so anything installed through `install.sh` had no semantic-recall helper: `resolveHelperScript()` found nothing, `recallVector` returned `unavailable`, and recall fell back to lexical results **in silence** — no error, no warning, no non-zero exit. v1.23.1 fixed the identical symptom for npm installs by adding the helper to `package.json` `files`; this second install route was left behind, so the same failure survived under a different cause. Copied file-by-file rather than with `cp -R`, mirroring that `files` list, because the helper's `node_modules` is ~850MB of devDependencies that must stay opt-in — and the packaging script now asserts both directions: the three helper entries must be present, and `skills/memoria-vector/node_modules` must not be. `scripts/test-no-clone-install.sh` asserts the files exist *and* that the installed CLI resolves the helper via `doctor --json`; verified failing against the pre-fix packaging script.
- **The release recipe printed by `scripts/bump-version.mjs` could not trigger a release.** Its next-steps output paired `git tag vX.Y.Z` (lightweight, no `-a`) with `git push --follow-tags` — and that flag pushes *only annotated* tags. The lightweight tag was skipped in silence: the push reported success, `main` advanced, and `release.yml` never fired, with nothing in git's output to indicate a tag had been withheld. Hit while releasing v1.25.1. `RELEASE.md` had the correct `git tag -a` all along, which is precisely why this survived — the recipe a person actually follows is the one the script just printed, not the one in a file they would have to go open. Fixed at both ends: the script now prints `-a`, and both it and `RELEASE.md` push the tag **by ref** (`git push origin refs/tags/vX.Y.Z`) instead of relying on `--follow-tags`, so a tag's type no longer decides whether a release happens. Docs-and-tooling only; no runtime or packaged output changes.

## [1.25.1] - 2026-08-13

### Fixed
- **`brief` no longer prints superseded memories** (issue-5 follow-up). `recall` has excluded them since markers shipped, but `queryBrief` never consulted `memory_attributes` — neither the decision query nor the UFL section — so a correction written with `--supersedes` produced the worst possible output: the replaced claim and its own correction listed in the same file, two lines apart, with nothing marking which one is current. That matters more here than anywhere else because `BRIEF.md` is the one artifact loaded into *every* session via `@knowledge/BRIEF.md`, and there is no command to delete a single memory (`prune` handles runtime artifacts and duplicate skills), so filtering here was the only remedy. Reproduced on a real 1.25.0 database: `recall` returned only the current note while `BRIEF.md` listed both. Filtered **in SQL** for decisions (a post-hoc filter would have made `LIMIT topK` yield topK *minus* however many were replaced) and **before `.slice(0, topK)`** for the UFL block, for the same reason. Matching on the event id is sufficient — `remember --supersedes` marks both halves of a CLI note. Both paths are guarded by the existing `memory_attributes` table probe, so a DB predating migration 14 is untouched. No `--include-superseded` counterpart is offered: an auto-loaded derived view must show exactly one version. `scripts/test-memory-attributes.sh` (C) now asserts the brief lists the replacement and not the replaced one — verified failing against the pre-fix build.

## [1.25.0] - 2026-08-10

### Changed
- **⚠ Envelope contract: `meta.confidence` can now be `null`** (issue-9). Semantic recall returned `confidence: 0` on hits it had found *correctly* — the number came from `tokenCoverage()`, a **lexical** measure, applied to the one route whose entire purpose is answering queries that do not quote the memory. The loop was self-defeating: the better the semantic match, the lower the reported confidence. Measured on a real database, a Chinese query with zero literal overlap ranked the right memory first and reported `confidence: 0`; CJK compounds the effect, since `TOKEN_SPLIT_PATTERN` keeps all CJK characters so a whole sentence becomes a single token that must appear verbatim to score at all. The honest answer is that this route cannot measure match quality — e5 cosine is range-compressed (measured 0.017–0.049 between rank 1 and rank 2), so nothing derived from it carries absolute meaning, which is exactly why fusion ranks by position (RRF) instead. A hit found only by the vector index therefore carries **no `relevance` field**, and `confidence` is `null` — "cannot judge", as distinct from `0`, which asserts a genuinely poor match. New `meta.confidence_basis` (`lexical_coverage` | `unavailable` | `no_hits`) names where the value came from, so callers never infer it from `route_mode`. In a fused `hybrid_vector` response both kinds coexist and the basis reports whichever produced the top hit. **Affects only the opt-in vector route**: without `LIBSQL_URL` no response ever changes. Also fixes a downstream distortion — such recalls used to pile into the calibration table's lowest confidence bucket and fake a "low confidence, high utility" pattern; `buildCalibration` already skips non-numeric confidence, so they now drop out instead. Rows written before this release keep their `0` and are not rewritten (telemetry is a historical record). `RFC-semantic-recall.md` §5b had specified `confidence` as the top fused score; that was never implemented and is not adopted here either — a fused value is ~0.0164, which merely replaces one misleading number with another.

### Fixed
- **`scripts/test-vector-recall.sh` no longer inherits the developer's vector environment.** The script asserts the degradation matrix, so it must control every vector variable itself — but on a machine with semantic recall wired into the shell profile, `LIBSQL_URL` / `MEMORIA_EMBED_PROVIDER` / `MEMORIA_VECTOR_RECALL_CMD` / `MEMORIA_VECTOR_TIMEOUT_MS` are all exported. The "`LIBSQL_URL` unset → `vector_unavailable`" case then reached the developer's **real** vector store, whose ids map to no row in the test database, and fell through to `route_mode=keyword`. CI never sets these, so it only bit locally — the same failure mode as the inherited `MEMORIA_HOME` fixed in v1.22.0. Now unset at the top of the script; `MEMORIA_VECTOR_E2E_REAL` is deliberately kept, being the caller's explicit opt-in. The other four scripts that mention vector/route_mode were audited by running them in the same dirty environment: all pass, because they only reference column names or assert the tree route.

## [1.24.0] - 2026-08-10

### Fixed
- **Promoted git memories now reach the tree index** (issue-7). issue-1's design called for promotion to write into `events` so the memory "automatically enters FTS and `buildMemoryIndex`'s existing path" — but only half of that held: FTS is trigger-maintained, while the tree index is a batch command nobody was calling. Two consequences, both silent: `mode:'tree'` recall could not see git-promoted memories *at all*, and the MCP bridge payload (whose scope is derived from `memory_nodes`) quietly narrowed to whatever `remember` had written, so vector ingest covered a fraction of the corpus while still reporting `{"ok":true}`. On a real database that was 3 of 10 sessions — 17 payload entities instead of 104. Promotion now indexes the session it just wrote, at both call sites, deliberately *outside* `promoteSummary`'s transaction (that function stays a pure DB write) and best-effort (a promotion is never undone by an indexing failure). Measured cost: ~3ms per session, flat as the corpus grows.

### Added
- **`stats` reports tree-index coverage** as `memoryIndex { sessions, indexed, missing }`, and the human-readable output warns with a `memoria index build` hint only when `missing > 0`. Databases written before this fix keep their gap until that command runs — this makes the gap visible instead of leaving it to be discovered when `tree` recall or a vector ingest silently returns less than it should. Deliberately not a `verify` check: `VerifyStatus` has no `warn`, `runVerify`'s `ok` requires every check to pass, and `MemoriaCore.health()` calls it — a lagging index would have dragged `/v1/health` to unhealthy, which overstates a condition that FTS recall is unaffected by.

## [1.23.1] - 2026-08-09

### Fixed
- **The semantic-recall helper now ships with the npm package**, so `mode:'vector'` is reachable from a plain `npm install -g @raybird.chen/memoria`. Previously `files` listed only `skills/memoria-memory-sync/`, while `resolveHelperScript()` looks for `<dist>/../skills/memoria-vector/vector-recall.mjs` — so an npm-installed Memoria could *never* resolve a helper and silently degraded to `vector_unavailable` forever, no matter how correctly `LIBSQL_URL` was configured. The exclusion was there to keep the ~700MB embedding runtime out of the package, but that runtime lives in `node_modules`; the helper's own source is a few KB. Only the `.mjs` sources plus `package.json` / `package-lock.json` / `README.md` are added (npm always excludes `node_modules`), taking the published package from 1.20MB to 1.22MB. Installing the helper's dependencies stays a deliberate opt-in step — `cd .../skills/memoria-vector && npm install` — and until you do, recall still fails open to lexical. `MEMORIA_VECTOR_RECALL_CMD` continues to work for pointing at an existing checkout. `test-npm-install.sh` now asserts the helper is reachable at exactly the path `resolveHelperScript()` computes, and that `node_modules` is not packaged.

## [1.23.0] - 2026-08-09

### Added
- **`stats` and `GET /v1/telemetry/recall` now report observed utility per recall route** (`recallRouting.routeUtility`). Both halves of the semantic-vs-lexical question have been shipped for a while — the UFL ruler since v1.18.0 and the `vector` route alongside it — but the readout that actually compares them was missing: `routeCounts` said how often each route ran and `calibration` said whether confidence tracked usefulness, while nothing said which route produced *more useful* memories. This adds mean observed utility grouped by `route_mode`, sorted best-first, with `uplift` as the gap to the runner-up. `best`/`uplift` stay `null` until at least two routes have scored outcomes, because naming a winner among one contestant would imply a comparison that never happened; per-route `scoredQueries` counts are kept visible so "not enough data yet" is legible rather than hidden behind an average. Additive and presentational: the block is omitted entirely until an outcome exists, so existing `stats` output is unchanged.

### Fixed
- **`brief` no longer lists a CLI note twice in its high-utility section.** A note written by `memoria remember` occupies two refs — its synthetic session and its event — and reporting an outcome attributes utility to both, so every such note appeared as two identical lines. They now collapse on their shared content fingerprint, keeping the session half (whose snippet is the plain text rather than the event's JSON payload). Found by actually using the command against a real memory database rather than a fixture.

### Changed
- `scripts/test-pure-functions.sh` joins the CI core group. The pure ranking/retention/calibration helpers (`effectiveUtility`, `computeDecayFactor`, `tokenCoverage`, `buildCalibration`, `buildRouteUtility`) were previously covered only indirectly through e2e flows — which prove the pipeline runs but not that the reuse threshold is 2, or that an explicit signal fully overrides the reuse proxy rather than being averaged with it. Those invariants are what the RFCs commit to, so they are now asserted directly against the functions (43 assertions, tsx driver, still no test framework).

## [1.22.1] - 2026-08-09

### Fixed
- **Re-importing the same session no longer duplicates its `recall_fts` rows** (issue-6). `importSession` used `INSERT OR REPLACE`, and SQLite resolves a key conflict there as an implicit DELETE + INSERT — but that implicit DELETE does not fire the `AFTER DELETE` trigger (`recursive_triggers` defaults to OFF) while the `AFTER INSERT` trigger does fire. Every re-`sync` of the same session id therefore left a stale index row beside the fresh one, and recall returned that memory twice, burning `top_k` slots that should have gone to other hits. Both statements now use a real upsert (`ON CONFLICT(id) DO UPDATE`), which takes the UPDATE path whose trigger correctly replaces the index row; every column is listed, so stored rows are identical to what REPLACE produced. Migration 15 rebuilds `recall_fts` from `sessions`/`events` to clear duplicates that existing databases already accumulated — the index is derived data, so a full refill is lossless and also corrects unrelated drift. Only these two tables have FTS triggers; the other eight `INSERT OR REPLACE` sites in the codebase write to trigger-less tables and are unaffected.

## [1.22.0] - 2026-08-09

### Fixed
- **`scripts/test-no-clone-install.sh` no longer runs against a real memory database.** The script exercises `setup` picking its own data root, so an inherited `MEMORIA_HOME` (exported by a developer's shell profile) both failed the "separated data root" assertion and pointed the test at the developer's actual `~/.memoria` — initialising it, deploying the skill into it, and starting a server against it. CI never sets the variable, so this only bit locally. The script now unsets it up front. Audited the other 30 test scripts the same way: every one of them already scopes `MEMORIA_HOME` to a temp directory.

### Changed
- **Superseded memories no longer appear in recall by default** (issue-5 Phase 2). `memoria remember "..." --supersedes <ref_id>` marks an existing memory as replaced; recall then returns only the current version, because a memory system whose answer to "which one is current?" is "here are both" has not actually resolved the contradiction. Nothing is deleted — `recall --include-superseded` (HTTP `include_superseded: true`) returns them with a `superseded_by` field attached, and `export` never applies the filter since it is the audit path. This is a contract change, but a no-op until something is marked: on a database with no markers, recall output is unchanged.

### Added
- **`memoria recall` / `memoria remember` / `memoria feedback`** (issue-4 Phase 1). The recall, single-note write and UFL utility write-back all existed in `core/` with HTTP and SDK exits, but none of the 17 registered CLI commands could reach them. That is only an inconvenience when a server is running — under skill-style integration (no hooks, no `memoria service`) an agent has bash and nothing else, so memory could be written but never read back and explicit utility had no way in at all. `recall` mirrors `POST /v1/recall` (`--project` / `--scope` / `--top-k` / `--time-window` / `--mode`), `feedback` mirrors `POST /v1/recall/:id/outcome` (`--signal` / `--score` / `--used` / `--hits`), and both print `--json` for machine consumption — human-readable `recall` output shows `relevance` (0–1) rather than the raw bm25-derived `score`, which rounds to `0.000` for every hit. Recall ordering, ranking and envelope are untouched: these are new callers, not new behaviour.
- **Long-term memory markers** (issue-5, migration 14 `memory_attributes`). One sparse side table keyed by `ref_id` — the id space `memory_utility` already uses — carries three markers written through `remember`: `--durable` (an evergreen fact: recall undoes its time-decay and `prune --stale-days` spares it — a 90-day half-life is simply the wrong model for "the user always uses pnpm", and the existing UFL exemption cannot save such a memory until it has accrued observations it may never get), `--supersedes <ref_id>` (see Changed above), and `--sensitivity private` (see below). Re-running `remember` with identical text applies markers without rewriting the memory, which is also how an existing memory gets marked — there is no separate command. Marking is sparse and every consumer probes the table first, so on a database where nothing is marked, recall (all four modes), prune and export are byte-identical to before; verified by replaying an unmarked database against the pre-migration build. `applyMemoryAttributes` deliberately runs *before* `applyUtilityWeighting` so observed utility remains the final arbiter and a mis-marked durable memory can still be pushed down.
- **`export --redact`** (issue-5 Phase 3) code-names known entities — repository names and project tags — inside memories marked `sensitivity='private'`, turning the "version-controlled documents use code names" convention from a rule people have to remember into something the tool does. It is deliberately a lookup over entities Memoria already knows rather than proper-noun detection: no guessing and no false positives, at the cost of covering only what it knows. Code names are deterministic per database (`proj-1a82`) so exports stay diffable, and the export summary always reports the `unclassified` count so it can never be mistaken for a blanket guarantee.
- **`memoria brief`** (issue-4 Phase 2) compiles recent decisions, high-utility memories (UFL) and per-repository state into `<knowledge>/BRIEF.md`. Importing it from `CLAUDE.md` with `@knowledge/BRIEF.md` gives context injection at the start of every session with nothing to execute — the practical substitute for hook-based injection when hooks and `memoria service` are deliberately not in use. Flags: `--project` / `--days` (default 30) / `--top-k` (default 10) / `--out` / `--stdout` / `--json`. It is a derived read-only view — every run overwrites the whole file, the header says so, and generation stays manual so no write path gains a file-output side effect. Optional tables (`memory_utility`, the `git_*` family) are probed before use, so it runs unchanged on a database predating UFL or Git-Aware Memory.
- **`memoria remember <text>`** writes one atomic note without going through a session JSON file, using the same shape `promoteSummary()` writes for git summaries: a synthetic session plus one `DecisionMade` or `SkillLearned` event, so extraction, recall, export and governance pick it up unchanged. Provenance lands in `memory_sources` as `source_type='cli_note'`. Session and event ids are content fingerprints, so re-running an identical note is a no-op — deliberately a *skipped write* rather than a rewrite, because `importSession` uses `INSERT OR REPLACE` whose implicit DELETE does not fire the `recall_fts` delete trigger, and a rewrite would therefore leave a duplicate FTS row and return the note twice. (That trigger gap is pre-existing and also affects re-running `sync` on the same session id; it is recorded in `docs/issues/issue-4/README.md` and not fixed here.)

## [1.21.1] - 2026-07-28

### Fixed
- **`repo summarize --tag` with a non-semver tag no longer degrades to a whole-repository range** (issue-3). The previous-release lookup only understood `v1.2.3`-style names; anything else (date stamps, `nightly-2026.0723`, …) found no previous tag and silently fell back to root..tag — on a real repository that meant a 542-commit / 1065-file "release" whose context ran to 157 KB with the diff unavailable. Semver comparison still wins when it applies; otherwise the boundary now comes from git creatordate order (`for-each-ref`, read-only). A genuine first release keeps its root..tag meaning. `repo sync` is unchanged — it still auto-summarizes semver tags only.

### Added
- **Summary context caps**: `git.summarization.maxContextCommits` (default 200) and `maxContextFiles` (default 500) bound the `commits[]` / `changed_files[]` lists in summary context — even a correctly-based huge range measured 58 KB + 98 KB. Truncation is never silent (a warning names kept/total) and `diffstat` always reflects the full range.

## [1.21.0] - 2026-07-28

### Changed
- **`repo summarize --pending` no longer ships the diff by default** (issue-2 Phase 1). The diff was 63–67% of a measured response and enrichment rarely used it; one real request dropped from 104 KB to 2.4 KB, which is what makes an automated agent write-back loop affordable. Opt back in with `--pending --with-diff` (HTTP `?with_diff=true`, SDK `repoPendingSummaries(ref, { includeDiff: true })`). New `--limit` / `?limit=` caps the batch (default 20 as before) — each pending summary rebuilds its own context, so the count multiplies response size.
- **No `pending` summary skeleton is auto-promoted during `repo sync`** (issue-2 Phase 2 + R1). Two paths previously let one through: §7.6 passed `merge`/`release` unconditionally, and any skeleton scoring at or above `promoteImportanceThreshold` (default 0.7) passed on importance alone. A skeleton is deterministic output — commit subjects only, empty `decisions`/`known_limitations`/`risks`, confidence 0.4 — so it now has to be enriched (`--submit`) before it can reach the recall corpus, whatever its type or score. Explicit `repo summarize --promote` is unchanged: it still force-promotes regardless of eligibility, and is the intended escape hatch.

### Documentation
- `docs/OPERATIONS.md` + `AGENTS.md`: pass `project` on recall when several repositories are registered — promoted git summaries use the repository name as their project, so an unscoped query mixes repositories (measured: an unrelated repository's decision reached the top 5 at score 0.383; scoped, the right decision came back at 0.936).

## [1.20.0] - 2026-07-16

### Added
- Native no-clone release artifacts for Linux and macOS on x64 and arm64. The tag workflow packages and exercises each artifact on a matching GitHub-hosted runner before publishing; `install.sh` auto-detects the Node runtime platform, supports URL preview/explicit platform routing, and has a shell contract test for all four targets.
- Per-user background service management for macOS and Linux: `memoria service install/start/stop/status/uninstall` writes a LaunchAgent or `systemd --user` definition without sudo. Installed services use an absolute Node executable and bundled CLI path so launchd/systemd do not depend on interactive shell `PATH`; lifecycle rendering and command sequences are covered for both platforms with mock-based tests.

### Fixed
- npm/npx installed mode now deploys the agent skill wrapper against the packaged `dist/cli.mjs` launcher instead of assuming the no-clone-only `bin/memoria` layout; repo-mode detection also works when running directly through `tsx`, and generated wrappers safely quote paths containing spaces.

### Changed
- Human-readable `memoria setup` output now reports the resolved data root, database, deployed skill, and server URL without changing the existing `--json` automation contract.
- Added a packed npm installation E2E and an Ubuntu/macOS CI matrix; release tags now test the npm artifact before publishing.

## [1.19.0] - 2026-07-13

### Added
- **Git-Aware Memory v1**（issue-1，docs/issues/issue-1/）— 非侵入式 Git 專案工程記憶：
  - `repo add/list/status/sync/summarize/relocate/remove` CLI 命令與 HTTP `/v1/repos/*` endpoints；SDK 對應方法。
  - 唯讀 git 執行層（規格 §5 白名單於 runtime 強制，`GIT_OPTIONAL_LOCKS=0`）；fingerprint 身份以 root commit 為主，shallow clone 降級為 `limited_history` 並於補齊歷史後就地升級。
  - 增量掃描（`git_commits`/`git_refs`/`git_scan_runs`，Migration 9–10）、快照差異事件（`git_events`，Migration 11，含 history rewrite 偵測 + lazy patch-id、`repo sync --dry-run` 零寫入）。
  - Summary pipeline（Migration 12）：deterministic range 分組 + trivial filter（重要檔案例外）+ 敏感路徑排除/secret 遮罩；merge/release/branch 摘要；摘要為結構化輸出，`repo summarize --pending`/`--submit` 供 host agent 回寫增強（Zod 驗證）。
  - Memory promotion（Migration 13）：高價值摘要升級為既有 recall 語料（session + DecisionMade events → FTS），`memory_sources` 保存 SHA 溯源、`memory_checkpoints` 記錄里程碑；recall hits 附 `source`（repository/branch/tag/base_sha/head_sha/summary_id）。
  - `prune --git-observations-days`（`--all` 預設 90d）清理過期 ref 觀察/已消化事件/完成的 scan runs，不動 commits 與摘要。
  - `<configPath>/config.json`（`git.*` 區塊，Zod 驗證，選用）為本 repo 首個設定檔。
  - 測試：`scripts/test-repo-*.sh` 八支 e2e（CI 新增 `repo` 測試群組），含非侵入性總驗收（完整流程後 git 狀態 byte-identical）。

## [1.18.0] - 2026-07-07

### Added
- **Semantic recall (`mode:'vector'`)** — opt-in semantic retrieval on top of the MCP/libSQL optional mode (`docs/RFC-semantic-recall.md`, status `phase-1-shipped`). Memories are embedded locally (`multilingual-e5-small`, chosen by a Traditional-Chinese/English/cross-lingual spike: 5/6 vs 2/6 for English-only MiniLM) and stored as libSQL **native vectors** (`F32_BLOB` + `vector_top_k`), bypassing `mcp-memory-libsql` (text-search only). Recall = lexical floor + RRF fusion, fully fail-open: no `LIBSQL_URL`/helper/timeout ⇒ lexical-only with `route_mode: vector_unavailable|vector_timeout`. Heavy deps live in `skills/memoria-vector/` (spawned via `node:child_process`; core gains **zero** runtime dependencies; Memoria-only mode untouched). New env: `MEMORIA_EMBED_PROVIDER`, `MEMORIA_EMBED_MODEL`, `MEMORIA_VECTOR_ENABLE`, `MEMORIA_VECTOR_TIMEOUT_MS`, `MEMORIA_VECTOR_RECALL_CMD`. Covered by `scripts/test-vector-recall.sh`.
- **Recall utility feedback loop (UFL), Phases 0–3** (`docs/RFC-utility-feedback.md`, status `phase-3-shipped`):
  - Phase 1: every successful `recall()` returns `meta.recall_id`; `POST /v1/recall/:id/outcome` + SDK `recordRecallOutcome` write observed utility back (Migration 6: `utility_score`/`outcome_kind`/`observed_at` on `recall_telemetry`); adapters report lexical-reuse utility automatically (fail-open).
  - Phase 2: confidence×utility calibration (bucketed `meanConfidence`/`meanUtility` + monotonicity flag) in `memoria stats` and `GET /v1/telemetry/recall` — presentational only, hidden until outcomes exist.
  - Phase 3: per-memory utility attribution via outcome `hits[]` (Migration 7: `memory_utility`); utility-weighted recall ranking (down-weight only, ≥2 observations required, byte-identical at zero data) and prune retention (stale/consolidate spare high-utility memories); explicit host feedback (`signal:'explicit'`, Migration 8) accumulates separately and overrides the reuse proxy; SDK `markRecallUseful`. Covered by `scripts/test-utility-ranking.sh` + extended prune/http/migrations tests.
- HTTP request bodies are capped (`MEMORIA_MAX_BODY_BYTES`, default 1 MiB) — oversized requests get a clean `413` instead of unbounded buffering.
- `install.sh` verifies the release tarball's SHA256 (`.sha256` artifact published by the release workflow) and validates `--version` format; release packaging emits the checksum file.

### Changed
- CI now runs as four parallel jobs (static checks / e2e matrix core–adapters–wiki–http-mcp / Node 18 smoke / release-artifact check).
- `--version` is injected at build time (esbuild define) with a package.json fallback in dev.
- `withDb` supports read-only pooled connections (`ro:`/`rw:` pool keys); read paths open the DB read-only.
- Keyword recall internals dedup'd (`buildSnippet`/`buildScopeClause`); `tokenCoverage`/`tokenizeQuery` moved to pure `core/utils.ts` so adapters don't pull in `better-sqlite3`.

## [1.17.0] - 2026-07-03

### Fixed
- **Antigravity CLI adapter now matches the real hook contract** (it was previously guessed and effectively non-functional). Verified against Antigravity's hook docs: Antigravity delivers no `prompt` / `last_assistant_message` payload fields — both the user prompt and assistant reply are read from `transcript_path` (like Claude Code) — and its output schema rejects a nested `hookSpecificOutput` wrapper. The adapter is now transcript-based and emits **flat** top-level `additionalContext`. (The remaining assumption is the transcript line format; capture a real payload to confirm — see below.)

### Added
- `MEMORIA_ADAPTER_DEBUG=<file>`: when set, `memoria adapter <name>` appends each raw hook payload (one JSON line) to the file. Use it to capture the real stdin shape from a host CLI and verify adapter field mappings against reality.
- `src/adapter/transcript.ts`: shared JSONL transcript parsing, now used by both the Claude Code and Antigravity adapters.

### Changed
- The Codex CLI adapter's field mapping was verified against Codex's official hook docs (`hook_event_name`, `UserPromptSubmit`+`prompt`, `Stop`+`last_assistant_message` string|null, `hookSpecificOutput.additionalContext`) and confirmed correct — comment updated, no logic change.

## [1.16.3] - 2026-07-03

### Changed
- Decision/Skill event field extraction (title, rationale, impact level, skill name, success rate, examples, …) is centralized in `src/core/extract.ts` (`parseDecisionEvent` / `parseSkillEvent`), replacing three copies of the same JSON-field heuristic in sync (markdown generation), recall (tree indexing), and telemetry (governance review). Behavior is unchanged; the standalone MCP bridge script keeps its own copy (separate Node runtime).

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
