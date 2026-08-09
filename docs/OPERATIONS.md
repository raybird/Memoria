# Operations Guide

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
- The UFL section stays empty until outcomes exist (`effectiveUtility` needs 1 explicit or 2 reuse
  observations), which is expected on a fresh database.

### Long-term memory markers (issue-5)

Three markers, all optional, all set through `remember`. Re-running `remember` with identical text
applies markers **without** rewriting the memory — that is how an existing memory gets marked:

```bash
./cli remember "使用者一律用 pnpm" --project Memoria --durable
./cli remember "資料庫改用 SQLite" --supersedes note-abc123 --supersede-note "單機部署不需要 PG"
./cli remember "內部部署細節" --sensitivity private
```

| marker | effect | escape hatch |
|---|---|---|
| `--durable` | recall undoes time-decay for it; `prune --stale-days` spares it | `--episodic` marks it explicitly time-bound |
| `--supersedes <ref>` | the old memory stops appearing in recall | `recall --include-superseded`; `export` never filters |
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

`mode:'vector'` is gated by `LIBSQL_URL` and the `skills/memoria-vector` helper:

```bash
cd skills/memoria-vector && npm install     # one-time (embedding runtime + libSQL client)
export LIBSQL_URL="file:/path/to/vectors.db"
export MEMORIA_VECTOR_ENABLE=1              # sync flow embeds each bridge payload into vectors
```

- First `local` embedding downloads the model (~120MB, cached in `~/.cache/huggingface`); a query that hits the download window fails open to lexical (`vector_timeout`) and recovers afterwards.
- `MEMORIA_VECTOR_TIMEOUT_MS` (default 4000) bounds the recall-side helper; warm-cache spawn measures ~1s.
- Compare utility uplift across `route_mode` groups (telemetry + UFL outcomes) to judge whether semantic recall beats lexical for your corpus.

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
