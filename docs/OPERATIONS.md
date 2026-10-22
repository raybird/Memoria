# Operations Guide

Last verified: 2026-10-23 against v1.31.1 source and CLI help for brief, markers and vector recovery.

## Runtime Health Commands

```bash
./cli stats
./cli doctor
./cli verify
./cli verify --json
./cli index build
./cli index build --project my-project --dry-run
./cli source list --json
./cli wiki build
./cli wiki lint --json
./cli prune --all --dry-run
./cli prune --consolidate-days 90 --dry-run
./cli prune --stale-days 180 --dry-run
./cli export --type all --format json
```

### `doctor` and the semantic layer

`doctor` reports the optional vector layer alongside the path checks (since v1.26.0, issue-12). It is
the only command that says which state semantic recall is actually in, because every failure on that
path is **fail-open by design**: a missing helper or a missing embedding backend degrades to lexical
results and still answers `ok:true`, with `route_mode` the only clue and nothing raised to the user.

| state | reported as |
|---|---|
| `LIBSQL_URL` unset | `vector recall: not enabled` — **passing**. An opt-in feature that is switched off is not an unhealthy install |
| enabled, helper resolves | `vector helper: <path>` plus `vector embedder` when the local provider is in use |
| enabled, helper missing | **fails**, with a fix naming `route_mode=vector_unavailable` as the symptom to expect |
| enabled, `@huggingface/transformers` missing, nothing beside the helper | **fails**, naming the user-cache directory for this helper's lockfile and `memoria setup --vector` as the fix (issue-25) — the shape of a global install, and of an upgrade that changed the helper's dependencies |
| enabled, `node_modules` beside the helper but no `@huggingface/transformers` | **fails**, with a fix naming the causes — `--omit=dev` / `NODE_ENV=production` — and the in-place `npm install` plus warm-up (issue-23). A sibling `node_modules` wins over the cache, so this is judged on its own |
| `MEMORIA_VECTOR_RECALL_CMD` set | printed as `vector helper (overridden)` so it is clear *which* helper was diagnosed. Its dependency layout is not probed — an overridden helper may be bundled elsewhere — and the embedder line **says so** (`not checked`, passing) rather than going missing, so the skip is visible to the people most likely to be affected by it |

## Memory Quality & Pruning

Memoria applies time-decay scoring to recall results: newer memories rank higher when token relevance is equal. The decay follows `1 / (1 + ageDays / 90)` — a 90-day-old memory scores at 50% of an equivalent new one, but never reaches zero.

Prune strategies for long-running instances:

```bash
# Consolidate: merge old session nodes under same topic (keeps newest, removes rest)
./cli prune --consolidate-days 90 --dry-run

# Stale: remove memory_nodes never recalled and orphan sessions older than N days
./cli prune --stale-days 180 --dry-run

# All-in-one: exports 30d + checkpoints 30d + dedupe + consolidate 90d + stale 180d
./cli prune --all --dry-run
```

Note: `--consolidate-days` only removes `memory_nodes` (level=2) — original `sessions` and `events` rows are preserved for audit trail and keyword recall. `--stale-days` removes both stale nodes and orphan sessions.

**Utility-weighted retention (UFL Phase 3)**: once a memory has accrued utility observations (via recall outcome write-backs), pruning respects them — `--stale-days` spares memories whose effective utility is ≥ 0.5 (explicit host feedback needs 1 observation, the lexical-reuse proxy needs 2), and `--consolidate-days` keeps the highest-utility child instead of merely the newest. With no utility data, behavior is exactly as described above.

## Tree Index Notes

- Memoria now auto-builds a lightweight tree index after each successful `sync`.
- Disable auto-build by setting `MEMORIA_INDEX_AUTOBUILD=0`.
- Manual incremental rebuild remains available via `./cli index build`.

### ⚠ `memory_nodes` holds its own copy of the text, and `index build` will not refresh it

`memory_nodes` is not a view over `sessions`. It carries **independent `title` / `summary` / `scope` /
`project` columns**, populated once from the session at index time. `recallTree` (and therefore
`mode: 'tree'`, the tree half of `hybrid`, and the MCP bridge payload, whose scope is derived from
`memory_nodes`) reads that copy — never `sessions`.

That matters because `buildMemoryIndex` selects sessions with

```sql
AND id NOT IN (SELECT DISTINCT session_id FROM memory_node_sources)
```

**unconditionally** — it indexes sessions that have *never* been indexed, not sessions that have
*changed*. Three consequences, in the order they bite:

1. **Editing `sessions.summary` in place never reaches tree recall.** The keyword path picks the change
   up immediately (FTS is trigger-maintained), so recall appears to work — while `tree` keeps serving
   the old text indefinitely.
2. **Re-running `index build` does not fix it**, because the session is already listed in
   `memory_node_sources` and is therefore skipped. `--session-id` does **not** override this; the
   `NOT IN` clause applies to it too.
3. **The output looks like success.** A skipped session leaves `sessionsConsidered: 0`, which is
   indistinguishable from "everything is already up to date".

A real instance: a downstream backfilled ~900 memories by rewriting `sessions`, re-ran the index
build, and got **0 recall hits** — the nodes still held the pre-backfill text and nothing said so.

**Recovery: delete the link rows only, then re-index.** `buildMemoryIndex` upserts with
`INSERT OR REPLACE`, so the node itself does not need removing — the only thing holding the refresh
back is the `NOT IN` check against `memory_node_sources`:

```bash
sqlite3 "$MEMORIA_HOME/.memory/sessions.db" \
  "DELETE FROM memory_node_sources WHERE session_id = '<id>';"
./cli index build --session-id '<id>'
# → sessionsConsidered: 1, sessionsIndexed: 1, nodesUpserted: 3
```

**Do not try to delete the nodes as well.** `memory_nodes.parent_id` is self-referencing (a session
node hangs off a topic node), so deleting a node while its children — or its `memory_node_sources`
rows — still exist fails with `FOREIGN KEY constraint failed`. Deleting them in the right order is
possible but pointless: the upsert already overwrites the row. (Both facts here were measured; the
first draft of this section prescribed the node deletion and got the constraint error.)

**Not yet addressed**: `index build` has no `--rebuild` / `--force`, and no change detection (there is
no content hash on the node to compare against). Adding either would remove the need for the manual
delete above; it has not been scoped. Until then, any tool that rewrites `sessions` — a backfill, a
migration, a repair script — has to treat node invalidation as part of its own job.

## Import Guardrails

- Memoria suppresses exact duplicate events within the same imported session.
- If a session summary is trivial (for example greetings or very short acknowledgements), Memoria derives a better summary from the first higher-signal event when possible.

## Scope Filtering

- You can attach `scope` to imported session JSON (for example `agent:main`, `user:alice`, `project:Memoria`, `global`).
- If omitted, Memoria defaults to `project:<project>` when `project` exists, otherwise `global`.
- Use `scope` in recall requests to isolate memory reads.
- **With multiple repositories registered, always pass `project` on recall.** Promoted git summaries
  carry `project = <repository name>`, so an unscoped query ranks every repository's memories
  together. Measured on a two-repo store, an unscoped question pulled an unrelated repository's
  decision into the top 5 (score 0.383); the same question scoped to one `project` returned the
  right decision at 0.936 with nothing foreign in the list. The bundled adapters already pass it
  (`BaseAdapter.recallForContext`); direct HTTP/SDK callers must do so themselves.

## Governance Review

- Use `./cli govern review --json` to inspect repeated decisions and skills worth promoting into durable rules/skills.
- Current governance review is deterministic and read-only; it does not mutate memory state.

## Compiled Wiki Operations

Use the wiki workflow when you need durable, human-browsable knowledge artifacts on top of session/source memory.

```bash
./cli source add notes/research.md
./cli wiki build
./cli wiki file-query --query "TS CLI migration" --title "TS CLI Migration Brief" --kind synthesis --scope project:Memoria
./cli wiki lint --json
```

Operational guidance:

- `source add` stores immutable raw text under `.memory/sources/` and generates `knowledge/Sources/*.md`
- `wiki build` refreshes `knowledge/index.md`, `knowledge/log.md`, and `knowledge/overview.md`
- `wiki file-query` should be reserved for high-value synthesis/comparison outputs, not trivial Q&A
- `wiki lint` writes durable governance findings so follow-up cleanup can be reviewed later

## Memory Access Without a Server (issue-4)

Under skill-style integration — no hooks, no `memoria service` — the CLI is the only way in, and all
three memory actions have direct commands. Nothing here needs `./cli serve`:

```bash
./cli remember "改用 pnpm" --project Memoria --rationale "lockfile 是權威"
./cli recall "為什麼用 pnpm" --project Memoria --json     # meta.recall_id feeds the next command
./cli feedback <recall_id> --signal explicit --score 0.9 --hits <hit_id,hit_id>
```

Notes that matter in practice:

- `remember` writes **one atomic note**, not a session. Ids are content fingerprints, so re-running an
  identical note is a skipped write (not a rewrite — a rewrite would leave a duplicate `recall_fts`
  row, see the trigger caveat in `docs/issues/issue-4/README.md` R1).
- Human-readable `recall` output shows `relevance` (0–1). The raw ranking `score` is bm25-derived and
  rounds to `0.000` for every hit, which is why it is not displayed; `--json` still carries both.
- A very short query can be skipped by the adaptive gate (`route_mode=skipped`) — **no `recall_id` is
  issued**, so a `feedback` call against it is a silent no-op. If utility is not landing in
  `memory_utility`, check that first.
- `feedback` on an unknown or pruned `recall_id` exits 0 with `updated:false` by design.

### Context injection via BRIEF.md

`brief` compiles the high-value slice of memory into a derived markdown file:

```bash
./cli brief --project Memoria --days 30      # writes <knowledge>/BRIEF.md
./cli brief                                 # registered cwd → <knowledge>/BRIEF-<project>.md
./cli brief --global                        # all projects → <knowledge>/BRIEF.md
./cli brief --stdout                         # print instead of writing
```

Import it once from `CLAUDE.md`:

```markdown
@knowledge/BRIEF.md
```

Every session then starts with recent decisions, high-utility memories (UFL) and repository state
already in context — no hooks, no server, nothing to execute. Operational caveats:

- It is a **derived view**. Each run overwrites the whole file; do not edit it by hand.
- Generation is **manual by design** — no write path regenerates it. Re-run `brief` after a batch of
  `remember` / `repo sync` work, otherwise the file silently ages.
- With no explicit `--project` or `--global`, the working directory determines scope when it belongs
  to a registered repository. Import the absolute path printed by the command into that project's
  `CLAUDE.md`. Outside registered repositories it falls back to the all-projects `BRIEF.md`.
- Memories whose project is not a registered repository name are environment-class and accompany
  each project's brief. Their count is reported on every run; registering a repository can change
  that classification.
- Durable memories have a separate pinned block, exempt from `--days` and `--top-k`. Superseded
  memories are excluded from all memory sections, including pinned and high-utility entries.
- The UFL section stays empty until outcomes exist (`effectiveUtility` needs 1 explicit or 2 reuse
  observations), which is expected on a fresh database.

### Long-term memory markers (issue-5)

Three markers, all optional. Re-running `remember` with identical text applies markers **without**
rewriting the note. To change retention or sensitivity on any existing memory, including a
git-promoted decision, use `mark` with a ref from `recall --json`:

```bash
./cli remember "使用者一律用 pnpm" --project Memoria --durable
./cli remember "資料庫改用 SQLite" --supersedes note-abc123 --supersede-note "單機部署不需要 PG"
./cli remember "內部部署細節" --sensitivity private
./cli mark <ref_id> --durable --note "Keep this constraint in every brief"
./cli mark <ref_id> --episodic              # restore time-bound retention
```

| marker | effect | escape hatch |
|---|---|---|
| `--durable` | recall undoes time-decay; `prune --stale-days` spares it; `brief` pins it outside the recency/size limits | `--episodic` marks it explicitly time-bound |
| `--supersedes <ref>` | the old memory stops appearing in recall and brief | `recall --include-superseded`; `export` never filters |
| `--sensitivity private` | `export --redact` code-names known entities inside it | — |

Operational notes:

- **Nothing marked = nothing changed.** Every consumer probes `memory_attributes` first, so a
  database where no marker exists behaves exactly as it did before issue-5.
- **`durable` does not make a memory immortal in ranking.** It only removes time-decay; UFL utility
  weighting still runs afterwards, so a wrongly-marked memory with poor observed utility sinks anyway.
- **Superseding is explicit, never inferred.** A `--supersedes` target that does not exist is rejected
  before anything is written. Chains (A←B←C) work without recursion — each row records only its own
  replacement, so a cycle cannot hang recall.
- **`--redact` is an aid, not a guarantee.** It replaces only entities Memoria already knows
  (repository names, project tags) and only inside memories explicitly marked `private`. The export
  summary always reports the `unclassified` count — memories exported verbatim because nobody marked
  them. Code names are deterministic per database (`proj-1a82`), so two exports stay diffable.

## Recall Quality Checks

Start server and inspect tree/hybrid routing metadata:

```bash
./cli serve --port 3917

curl -sS -X POST http://localhost:3917/v1/recall \
  -H 'Content-Type: application/json' \
  -d '{"query":"StreamVue pricing","mode":"tree"}'

curl -sS -X POST http://localhost:3917/v1/recall \
  -H 'Content-Type: application/json' \
  -d '{"query":"StreamVue pricing","mode":"hybrid"}'
```

Look at `meta.route_mode`, `meta.fallback_used`, and `meta.reasoning_path`.

- `route_mode=skipped` means adaptive retrieval intentionally bypassed memory lookup for a trivial query.

You can also inspect aggregated telemetry in stats:

```bash
./cli stats
./cli stats --json
```

Check `recallRouting` for 7-day route counts, fallback rate, and latency percentiles. Once recall outcomes have been reported (adapters do this automatically), a `calibration` block appears — confidence buckets vs mean observed utility, with a monotonicity flag that tells you whether `confidence` actually tracks usefulness. Vector-route counters (`vector` / `hybrid_vector` / `vector_unavailable` / `vector_timeout`) show up once `mode:'vector'` has been used.

Recalls whose top hit came from the semantic index alone record `top_confidence` as NULL and are **excluded from `calibration`** (since v1.25.0, issue-9) — there is no lexical match quality to bucket them by. Before that release they were recorded as `0` and piled into the lowest bucket, which manufactured a "low confidence, high utility" pattern; those rows were not rewritten, so a calibration table spanning the upgrade still contains them. `routeUtility` is unaffected either way — it reads observed utility, not confidence.

A `routeUtility` block appears alongside it once outcomes exist — **this is the one that answers "is semantic recall actually better than lexical?"**:

```
- route_utility: scored=24, best=vector (+0.18)
  - vector: n=11, mean_utility=0.78, mean_conf=0.61
  - keyword: n=13, mean_utility=0.6, mean_conf=0.55
```

Read it carefully:

- `best` and `uplift` are `null` until **two** routes have scored outcomes. One route has nothing to be better than, and reporting it as the winner would imply a comparison that never happened.
- The per-route `n` is the whole basis of the claim. A `+0.18` uplift over `n=2` versus `n=3` means nothing; give it dozens of outcomes per route before drawing conclusions.
- Nothing here is a significance test. It is a readout, not a verdict — the numbers are for you to judge.
- To get `vector` rows at all you need `LIBSQL_URL` plus the `skills/memoria-vector` helper, and queries actually issued with `mode:'vector'`.

For raw recall telemetry rows (HTTP; rows carry `utility_score` / `outcome_kind` / `observed_at` when an outcome was written back):

```bash
curl -sS "http://localhost:3917/v1/telemetry/recall?window=P7D&limit=50"
```

## Semantic Recall Operations (optional)

`mode:'vector'` is gated by `LIBSQL_URL` and the `skills/memoria-vector` helper. The helper ships as
**source only**; its embedding runtime is an optional separate install:

```bash
# from a checkout
cd skills/memoria-vector && npm install

# from an npm install: dependencies + model go to ${XDG_CACHE_HOME:-~/.cache}/memoria/vector (issue-25)
memoria setup --vector

export LIBSQL_URL="file:/path/to/vectors.db"
export MEMORIA_VECTOR_ENABLE=1              # sync flow embeds each bridge payload into vectors
```

`npm install --omit=dev` in a checkout installs only `@libsql/client` (~24MB) — enough for the `stub`
provider and for ingest plumbing, but the `local` provider needs the full install. `setup --vector`
follows `MEMORIA_EMBED_PROVIDER` the same way: `stub` installs only `@libsql/client` and skips the model.

- Where the helper loads its dependencies from is decided by `skills/memoria-vector/deps.mjs`, and `node deps.mjs` prints the answer: a `node_modules` beside the helper wins (checkout, or an image that bundles it), otherwise `${XDG_CACHE_HOME:-~/.cache}/memoria/vector/<hash>/`, where `<hash>` is taken from the helper's `package-lock.json` and only a directory carrying `.complete` counts.
- First `local` embedding downloads the model (~120MB). With cache-installed dependencies it goes to `${XDG_CACHE_HOME:-~/.cache}/memoria/vector/models/` and `setup --vector` downloads it up front. With a sibling `node_modules`, transformers.js keeps it **inside its own package**, at `node_modules/@huggingface/transformers/.cache/` under the helper, so it goes wherever that `node_modules` goes. A query that hits the download window fails open to lexical (`vector_timeout`) and recovers afterwards.
- `MEMORIA_VECTOR_TIMEOUT_MS` (default 4000) bounds the recall-side helper; warm-cache spawn measures ~1s.
- Compare utility uplift across `route_mode` groups (telemetry + UFL outcomes) to judge whether semantic recall beats lexical for your corpus.

### Three things that will silently give you no semantic recall

**1. The helper's dependencies are never installed for you.** `resolveHelperScript()` finds the
packaged helper at `<dist>/../skills/memoria-vector/vector-recall.mjs`, but installing `memoria`
does not install *that* directory's `package.json` — it is a separate npm project on purpose, so the
~700MB embedding runtime stays opt-in. Until you run `memoria setup --vector` (or `npm install`
inside a checkout's helper), `mode:'vector'` degrades to `vector_unavailable` (fail-open: lexical
recall still answers).

On **v1.23.0 and earlier** the helper was not packaged at all, so an npm install could never resolve
it. There the only route is pointing at a checkout:

```bash
export MEMORIA_VECTOR_RECALL_CMD="/path/to/Memoria/skills/memoria-vector/vector-recall.mjs"
```

That override still works on current versions — useful when you already have a checkout with the
runtime installed and would rather not download it twice.

**2. The runtime is ready, but memories have not reached the vector index.** `setup --vector`
installs dependencies and warms the model; it does not ingest your corpus. The bridge payload derives
its scope from `memory_nodes`, so missing tree nodes must be indexed before vector ingest. Since
v1.24.0, git promotion automatically indexes its session (best-effort); older databases or a failed
auto-build can still have gaps. `memoria stats` reports tree-index coverage. First repair any gap:

```bash
memoria index build                     # picks up every session that has no node yet
memoria doctor                          # with LIBSQL_URL set, inspect vector coverage and its fix
```

Verify coverage rather than assuming it: `memoria doctor` (in a shell with `LIBSQL_URL` set) reports
`vector coverage: embedded=… expected=… missing=…`. When `missing` is above 0, its fix ends in
`Run: <command>` — one line with this install's absolute paths and your data root, which you can paste
as printed (issue-27). It writes the payload to a temporary directory rather than the data root,
uses a dedicated sync target without a cursor so the whole corpus is covered, and exits with ingest's
status. Keep the same `LIBSQL_URL` and `MEMORIA_EMBED_PROVIDER` as the doctor invocation, then run
doctor again to verify `missing=0`.

With `MEMORIA_DB_PATH` pointing outside `<home>/.memory/sessions.db`, doctor names the path mismatch
and prints no ingest command: the payload builder reads the data root's default database. Use a data
root whose `.memory/sessions.db` is the intended database. Remote libSQL and overridden helpers report
coverage as `not measured`; `read_failed` and `no_local_db` also mean coverage is unknown, not complete.

Counting the store by hand needs `SELECT COUNT(*) FROM memoria_vectors
NOT INDEXED`: without `NOT INDEXED`, stock SQLite counts through libSQL's vector index and returns 0
on a fully populated store.

**3. An upgrade that changes the helper's dependencies needs `setup --vector` again.** `npm i -g
@raybird.chen/memoria@<new>` replaces the whole package directory. Dependencies that `setup --vector`
put in the user cache survive that, and so does the model (issue-25); what moves is the directory
name, which hashes the helper's `package-lock.json`. A release that changes it looks for a directory
that does not exist yet, so recall keeps answering with lexical hits (`vector_unavailable` /
`vector_timeout`) and `doctor` reports the embedder missing, naming the new directory. Run it in a
shell that has `LIBSQL_URL` set — without it `doctor` reports `vector recall: not enabled` as
passing, which reads like all green:

```bash
memoria setup --vector     # installs the new dependency set, reuses the cached model, warms it
memoria doctor             # embedder installed; ingest separately if vector coverage has gaps
```

The warm-up matters: a cold first load measured ~14–17s against ~1s warm, longer than
`MEMORIA_VECTOR_TIMEOUT_MS`, so `setup --vector` pays it rather than leaving the first recalls to
report `vector_timeout`. The previous hash directory (~720MB) stays behind; delete it once no
installed version uses it. Before issue-25 the dependencies lived beside the helper, so **every**
global upgrade wiped them together with the model — a `node_modules` someone installed there by hand
still behaves that way, and still wins over the cache while it exists. The vectors themselves live
in `LIBSQL_URL`, outside the package, and survive any upgrade — no re-ingest is needed.

### Reading vector distances

e5 compresses its cosine range, so **absolute distances mean nothing across queries** — in one real
corpus an unrelated hit scored 0.1485 while a near-paraphrase of a different memory scored 0.1068.
Judge only the *relative* spread within a single query: a genuine match sits visibly below the rest,
whereas a query with no good answer returns a flat band of near-identical distances. This is why
fusion is rank-based (RRF) and why nothing thresholds on raw cosine.

## Git-Aware Memory Operations

Read-only observation of existing git repositories (`docs/issues/issue-1/`). Memoria never
mutates a managed repo: only an allowlisted set of read subcommands runs against it
(`GIT_OPTIONAL_LOCKS=0`), and `scripts/test-repo-noninvasive.sh` asserts byte-identical state.

```bash
./cli repo add /path/to/project          # register (initial scan: recent 200 commits; --scan-history lifts)
./cli repo sync <repo> [--dry-run]       # incremental scan → events → summaries → promotion
./cli repo status <repo>                 # registry + live head/dirty/shallow state
./cli repo summarize <repo> --pending --json     # summary requests awaiting agent enrichment (no diff)
./cli repo summarize <repo> --pending --with-diff --limit 5      # opt back into the diff, cap the batch
./cli repo summarize <repo> --submit <id> --file payload.json   # agent write-back (auto-promotes if eligible)
./cli repo relocate <repo> <new-path>    # re-bind a moved clone (same history required)
./cli repo remove <repo>                 # stop scanning; memories/summaries kept unless --delete-* flags
```

- **Sync cadence**: run `repo sync` at session start/end or on demand; unchanged repos complete
  fast (incremental `--not <previous tips>` walk) and insert nothing.
- **Config**: `<configPath>/config.json`, `git.*` block (optional; Zod-validated). Tunables:
  `summarization.{minimumCommits,minimumChangedLines,branchIdleHours,promoteImportanceThreshold,includeDiff,maxDiffBytes,maxContextCommits,maxContextFiles}`,
  `filters.{excludePaths,sensitivePaths}`. `maxContextCommits` (200) / `maxContextFiles` (500) cap
  the summary context lists; truncation is never silent (a warning names the dropped count) and
  `diffstat` always reflects the full range.
- **Release tags**: the previous-release boundary prefers semver comparison; tags that don't parse
  as semver (date stamps, `nightly-2026.0723`, …) fall back to git creatordate order, so an
  explicit `repo summarize --tag` no longer degrades to a whole-repository root..tag range. Note
  `repo sync` still auto-summarizes **semver tags only**.
- **Retention**: `prune --git-observations-days <N>` (in `--all` at 90d) removes superseded ref
  observations, consumed events, and finished scan runs — never `git_commits`, summaries, or
  promoted memories, so SHA traceability survives pruning.
- **Enrichment payload size**: `--pending` omits the diff by default (issue-2 Phase 1). Measured on
  a real branch, the diff was 63–67% of the response — dropping it took one request from 104 KB to
  2.4 KB, which is what makes an automated write-back loop affordable. Add `--with-diff` when the
  commit messages and file list genuinely are not enough, and `--limit` to cap the batch (each
  pending summary rebuilds its own context, so the count multiplies response size).
- **Promotion gate**: a `pending` skeleton is *not* auto-promoted during `repo sync` — regardless of
  summary type or importance, it must be enriched via `--submit` first (empty decisions at
  confidence 0.4 would only dilute the corpus). Explicit `repo summarize --promote` still
  force-promotes regardless, and is the intended escape hatch.
- **Secrets**: sensitive paths are excluded from summary context and secret-like values in diffs
  are masked (best-effort, pattern-based); masking leaves a `sensitive_content_detected` warning
  in the summary metadata. Raw diffs are never persisted. Note masking only applies to diff text —
  it is only exercised when the diff is actually requested (`--with-diff`).
- **Troubleshooting**:
  - `repository_not_found` on sync after moving a clone → `repo relocate`.
  - `repository_identity_mismatch` → the path now holds a different history; re-check the path or `repo add` it as a new repository.
  - Shallow clones register as `limited_history`; after `git fetch --unshallow`, re-run `repo add` — the identity upgrades in place (no duplicate).
  - Failed scans keep their reason in `git_scan_runs` (`status='failed'`); the next sync resumes from the last good state.
  - Concurrent syncs of one repository are serialized in-process; avoid concurrent CLI+server syncs from separate processes (documented v1 limitation).

## Test Commands (see also `scripts/test-cli-memory.sh` for the no-server memory loop)

```bash
bash scripts/test-smoke.sh
bash scripts/test-bootstrap.sh
bash scripts/test-adapter-runtime.sh
bash scripts/test-no-clone-install.sh
bash scripts/test-mcp-e2e.sh
bash scripts/test-wiki-ingest.sh
bash scripts/test-wiki-build.sh
bash scripts/test-wiki-query-fileback.sh
bash scripts/test-wiki-lint.sh
bash scripts/test-repo-git-exec.sh
bash scripts/test-repo-registry.sh
bash scripts/test-repo-sync.sh
bash scripts/test-repo-events.sh
bash scripts/test-repo-summary.sh
bash scripts/test-repo-promotion.sh
bash scripts/test-repo-edge.sh
bash scripts/test-repo-noninvasive.sh
```

## CI Parity (Local)

```bash
pnpm install
pnpm run check
pnpm run build
node dist/cli.mjs --help
bash -n install.sh
bash scripts/test-smoke.sh
bash scripts/test-bootstrap.sh
bash scripts/test-adapter-runtime.sh
bash scripts/test-no-clone-install.sh
bash scripts/test-mcp-e2e.sh
bash scripts/test-wiki-ingest.sh
bash scripts/test-wiki-build.sh
bash scripts/test-wiki-query-fileback.sh
bash scripts/test-wiki-lint.sh
bash scripts/test-repo-git-exec.sh
bash scripts/test-repo-registry.sh
bash scripts/test-repo-sync.sh
bash scripts/test-repo-events.sh
bash scripts/test-repo-summary.sh
bash scripts/test-repo-promotion.sh
bash scripts/test-repo-edge.sh
bash scripts/test-repo-noninvasive.sh
```

## Release SOP

Patch release flow lives in `RELEASE.md`.

Use it when docs, verification steps, runtime packaging, or release metadata change.

## Backup

```bash
tar -czf ai-memory-backup-$(date +%Y%m%d).tar.gz "$MEMORIA_HOME"
```

## Security Basics

```bash
chmod 700 "$MEMORIA_HOME/.memory"
chmod 600 "$MEMORIA_HOME/.memory/sessions.db"
```

### HTTP server exposure

The `serve` HTTP API has **no authentication, CORS, or rate limiting** by design — it is meant
for local/self-host use. Do not bind it to a public interface. Keep it on `localhost` (default)
or place it behind a reverse proxy / firewall that enforces access control.

Request bodies are capped at **1 MiB** by default to avoid unbounded memory growth; oversized
requests get `413`. Override with `MEMORIA_MAX_BODY_BYTES` (in bytes) if you legitimately ingest
larger payloads.
