# RFC: Semantic Recall Loop

- Status: `blocked` — Phase 0 invalidated the "read semantics back from libSQL" premise; needs an embedding-backend decision. See [§13 Phase 0 Findings](#13-phase-0-findings-2026-07-02).
- Created: 2026-07-02
- Updated: 2026-07-02 (Phase 0 spike results)
- Roadmap anchor: `RFC.md` → Candidate Direction #2 (*Native semantic retrieval workflows beyond MCP bridge*)
- Scope: turn the one-way Memoria → libSQL bridge into a two-way loop by adding a `vector` recall mode.

## 1. Motivation

Today the whole retrieval stack is lexical-only. `recallKeyword` uses a whole-query
`LIKE '%query%'` plus substring token scoring (`src/core/db/recall.ts`), and there is
no embedding anywhere in `src/` (`grep embed|vector|cosine` → 0 hits). Meanwhile the
MCP/libSQL bridge already pushes Memoria entities into `mcp-memory-libsql`, which stores
embeddings and exposes `search_nodes` — but the bridge is **one-way**: the ingest calls
`search_nodes` only as a throwaway verify step and discards the result
(`skills/memoria-memory-sync/scripts/ingest-mcp-libsql.mjs:195`).

We are paying to build a semantic index and never reading from it. This RFC closes that
loop: `recall()` gains an optional `vector` mode that queries the semantic index and fuses
its results with lexical recall.

## 2. Design Principles

Three observations make this clean and low-risk:

1. **libSQL is a semantic *index*, not a store.** `search_nodes` returns *which ids are
   semantically relevant and how similar*. The authoritative content (timestamp, project,
   snippet) is always re-read from the local SQLite source of truth. This matches the
   existing dual-layer model in `SKILL.md` ("Treat MCP as additive index, not replacement
   storage").
2. **The id mapping already exists.** The entity `name` sent to libSQL *is* the prefixed
   Memoria id (`build-mcp-tool-requests.mjs:44` → `name = entity.id`): `session:<id>`,
   `mem_node:<node_id>`, `decision:<event_id>`, `skill:<slug>`. Parsing the prefix recovers
   the type and id. **No new table, no migration.**
3. **Purely additive, zero default cost.** The vector route only runs when a caller passes
   `mode: 'vector'`. The `keyword` / `tree` / `hybrid` code paths are untouched. When
   `LIBSQL_URL` is unset the mode degrades to lexical recall, so Memoria-only stays fully
   functional.

Principle 3 is a hard constraint, not a preference: `recall()` has a **CRITICAL** upstream
blast radius (7 impacted symbols across 5 execution flows — `/v1/recall` via
`createServer`, `fileQuery`, wiki `file-query`, the CLI `run`, and `setup`). The only safe
change is one that leaves every existing branch byte-identical.

## 3. Data Flow

```
recall({ mode: 'vector' })
  │
  ├─ (A) recallKeyword ─────── always runs first; authoritative floor & fail-open baseline
  │
  └─ (B) recallVector (timeout ~1500ms, fail-open)
          │  spawn query-mcp-libsql.mjs → JSON-RPC search_nodes
          │  → [{ name: "session:abc", score: 0.83 }, { name: "mem_node:x9", ... }]
          │  → parse prefix → look up local SQLite → RawRecallRow[] (authoritative fields)
          ▼
   RRF fuse (A)+(B) → dedupe by id:session_id → topK → RecallHit[]
```

Baseline guarantee: if (B) times out or is unavailable, only (A) is returned, `ok: true`,
never blocked.

## 4. Components and Change Points

| File | Action | Content |
|------|--------|---------|
| `skills/memoria-memory-sync/scripts/query-mcp-libsql.mjs` | **new** | Sibling of the ingest script. Spawns `mcp-memory-libsql`, runs `initialize` → `tools/call search_nodes`, normalizes to `{ hits: [{ name, entityType, score, observations }] }` on stdout. Reuses the existing env conventions. |
| `src/core/recall-vector.ts` | **new** | `recallVector(dbPath, query, project, scope, topK)`: resolve command (`MEMORIA_MCP_RECALL_CMD` override, else the default helper), spawn with a timeout, parse `name` → local SQLite lookup → `RawRecallRow[]`. Returns `{ rows: [], status: 'unavailable' }` when `LIBSQL_URL` is unset. **No new core runtime dependency** — uses `node:child_process`. |
| `src/core/memoria.ts` `recall()` | edit (add branch) | After `treeRaw`/`keywordRaw`, when `mode === 'vector'` acquire `vectorRaw` and fuse. Existing branches unchanged. |
| `src/core/types.ts` | edit (additive) | `RecallFilter.mode` add `'vector'`; `StatsData.routeCounts` add `vector` / `hybrid_vector` / `vector_unavailable` / `vector_timeout`. |
| `src/core/db/telemetry.ts` | edit | Extend `queryStats` routeCounts aggregation for the new route values. |
| `src/server.ts` | verify | Ensure the `/v1/recall` `mode` validation (if any) accepts `'vector'`. |
| `scripts/test-mcp-e2e.sh` | edit | Add semantic-recall assertions (see §8). |

## 5. Key Algorithms

### 5a. `name` → `RawRecallRow` mapping

| Entity prefix | `RecallHit.type` | Local lookup | Note |
|---------------|------------------|--------------|------|
| `session:<id>` | `session` | `sessions WHERE id=?` | |
| `mem_node:<nid>` | `session` | `memory_nodes` + `memory_node_sources` → source session | carry back `node_id` |
| `decision:<eid>` | `decision` | `events WHERE id=?` | |
| `skill:<slug>` | `skill` | `skills WHERE ...` | |
| `event:` / `project:` | — | ignored | not `RecallHit.type` values |

Filling fields from the local lookup (rather than trusting the libSQL copy) also sidesteps
the index-lag problem in §7.

### 5b. Fusion via Reciprocal Rank Fusion (RRF)

```
score_fused(d) = Σ_route  1 / (k + rank_route(d))     // k = 60
```

Lexical score is `relevance × decay`; vector score is a similarity distance — **different
scales**. RRF ranks by position only, needs no score normalization, and is the standard
robust choice for hybrid search. `confidence` becomes the top fused score (documented as a
scale change; ties into the separate "decouple confidence from decay" item).

## 6. Gating / Degradation Matrix

| Condition | `route_mode` | Returns |
|-----------|--------------|---------|
| `LIBSQL_URL` unset | `vector_unavailable` | lexical only, `ok: true` |
| helper timeout | `vector_timeout` | lexical only |
| helper ok, 0 hits | `keyword` | lexical only |
| helper ok, hits + lexical also contributed | `hybrid_vector` | fused |
| helper ok, vector-only hits | `vector` | vector |

Reused env: `LIBSQL_URL`, `LIBSQL_AUTH_TOKEN`, `MEMORIA_MCP_SERVER_COMMAND` / `_ARGS`.
New: `MEMORIA_MCP_RECALL_CMD` (override the query command), and a recall-scoped
`MEMORIA_MCP_TIMEOUT_MS` (default lowered to ~1500ms because it sits on the recall hot path).

## 7. Latency Strategy

- Lexical recall runs first and is authoritative; vector is additive under a strict timeout
  and **never blocks**.
- `npx mcp-memory-libsql` cold-start cost is **accepted for the MVP** because the mode is
  opt-in — you only pay it when you explicitly ask for `vector`.
- Phase 2: keep a long-lived pooled MCP server process in `serve` mode, mirroring the
  "reuse connections on the hot path" philosophy in `src/core/db/connection.ts`.
- The default `/v1/recall` path is unaffected since vector is per-request opt-in.

## 8. Risks and Compatibility

| Risk | Mitigation |
|------|-----------|
| `recall()` is CRITICAL blast radius (7 symbols / 5 flows) | Purely additive: existing modes' code paths stay byte-identical; new logic only under `mode === 'vector'`. |
| `search_nodes` wire shape unverified | Phase 0 spike captures the real response before any code depends on it. |
| Test non-determinism (embeddings) | Assert "expected id appears in results", not exact ordering; gate the e2e on availability like `test-mcp-e2e.sh`. |
| Vector index lag (incremental cursor) | Very recent memory not yet ingested is covered by the lexical floor; documented. |
| No new core dependency allowed | Use `spawn`, not `@libsql/client`; consistent with the repo's lean-deps rule. |
| `mode` union compatibility | Adding a literal is additive; HTTP validation must accept the new value. |

## 9. Test Plan

1. **Semantic beats lexical**: in `test-mcp-e2e.sh`, after ingest, run `recall --mode vector`
   with a query that is semantically related but lexically disjoint from a seeded memory,
   and assert the seeded id appears.
2. **Fail-open**: unset `LIBSQL_URL` + `mode vector` → `ok: true`, `route_mode:
   vector_unavailable`, still returns lexical hits.
3. **Timeout**: point `MEMORIA_MCP_RECALL_CMD` at a sleep stub → `route_mode: vector_timeout`,
   lexical returned.
4. `pnpm run check` + `build` + `node dist/cli.mjs` smoke; `bash -n` on touched scripts;
   `gitnexus_detect_changes` before commit.

## 10. Phased Delivery

- **Phase 0 (spike, ~0.5d)**: capture the real `search_nodes` response shape from
  `mcp-memory-libsql`. Everything downstream is gated on this.
- **Phase 1 (MVP, ~1–1.5d)**: query helper + `recallVector` + `mode: 'vector'` (lexical floor
  + vector) + RRF + fail-open/timeout + types + one e2e.
- **Phase 2**: pooled MCP server for `serve`; optional vector fusion inside `hybrid`;
  telemetry enrichment.
- **Phase 3**: semantic dedup and real synthesis (from the wiki briefing).

## 11. Open Decisions

1. **Mode naming**: a new standalone `'vector'` literal (recommended, least surprising) vs.
   auto-upgrading `'hybrid'` when `LIBSQL_URL` is set (more seamless but changes existing
   `hybrid` semantics).
2. **Phase 0 first**: strongly recommended to capture a real payload before coding, to avoid
   repeating the "guessed adapter fields" pattern.

## 12. Definition of Done

1. `pnpm run check` passes.
2. `pnpm run build` succeeds and `node dist/cli.mjs --help` runs.
3. `scripts/test-mcp-e2e.sh` passes (including the new vector assertions).
4. Touched shell scripts pass `bash -n`.
5. CLI flags/output remain consistent; `mode vector` documented in help and README.

## 13. Phase 0 Findings (2026-07-02)

A spike drove `mcp-memory-libsql` directly over JSON-RPC (`initialize` → `tools/list` →
`create_entities` → `search_nodes` → `read_graph`) to pin the real wire behaviour before
building anything. Three findings, one of them blocking.

### 13.1 Wire shape (usable as designed)

- Tool results are **double-encoded**: `{ content: [{ type: 'text', text: <json-string> }] }`,
  where `text` must be `JSON.parse`d again into `{ entities: [...], relations: [...] }`.
- Each entity is `{ name, entityType, observations[] }`. The prefixed-id mapping in §5a holds
  exactly (`search_nodes("session:spike-alpha")` returned `name: "session:spike-alpha"`).
- **No similarity/distance score is returned** — results carry order only. This actually
  *reinforces* the RRF choice in §5b (RRF ranks by position, not score), so the fusion design
  survives unchanged.

### 13.2 Blocking finding: the semantic premise is false

`mcp-memory-libsql` does **not** do semantic search. Evidence:

- A lexically-disjoint semantic query (`"money planning and financial projections"` against a
  seeded `"Q3 budget and revenue forecast"` entity) returned **`entities: []`**, while an exact
  name query matched. It is literal text matching, not embedding similarity.
- The bundled search runs `LIKE` against `entities`/`observations` (no `vector_top_k`, no
  `F32_BLOB`, no cosine). The package description is now *"optimized text search"* and the
  README advertises *"text search with relevance ranking / fuzzy matching"*.
- **No published version carries an embedding capability.** Across all 15 releases
  (`0.0.1`–`0.0.17`) the dependency set is `@libsql/client` + MCP/tmcp glue + `dotenv` — never
  an embedding library. `0.0.17` is a text-search-only rewrite; earlier versions had no
  embeddings either.

Consequence: reading `search_nodes` back into `recall()` would return **nothing better than
the existing local `recallKeyword`** (which additionally has token scoring + time decay). The
"read semantics back from libSQL" loop, as originally framed, delivers no semantic value.

### 13.3 Revised direction — native semantic (beyond MCP bridge)

The design's mechanics (prefixed-id mapping §5a, RRF fusion §5b, gating/degradation §6,
fail-open/timeout §7) all still apply. **Only the source of vectors changes**: from
"mcp-memory-libsql's (nonexistent) semantic index" to a real embedding backend that Memoria
owns. This is exactly what `RFC.md` Candidate #2 means by *"beyond MCP bridge"*. Two axes must
be decided:

- **Embedding source**
  - Local model via `@huggingface/transformers` (e.g. `all-MiniLM-L6-v2`): no API key, no
    per-call cost, private; but ~90MB first-run model download, CPU inference latency, and a
    heavy new dependency.
  - Hosted API (OpenAI / Voyage / Cohere): tiny dependency, fast, high quality; but network
    dependency, per-call cost, and key management.
- **Vector store + search**
  - `sqlite-vec` extension loaded into Memoria's existing `better-sqlite3` database: fully
    self-contained, **no MCP server and no libSQL required**, keeps Memoria-only mode intact.
  - libSQL native `F32_BLOB` + `vector_top_k`: reuses the libSQL path but requires libSQL.

Both directions add at least one dependency, which conflicts with the repo's deliberate
lean-deps rule — so this is an explicit maintainer decision, not a default. **Recommended:**
`sqlite-vec` in the existing DB + a local `@huggingface/transformers` model — it keeps the
whole semantic layer local-first and drops the MCP/libSQL requirement entirely.

**Status: blocked pending the embedding-backend decision above.** The alternative, if taking
on an embedding dependency is unwanted, is to redirect this effort to the no-dependency
lexical upgrade (SQLite FTS5/BM25 + per-token matching), which is a guaranteed win and needs
no embeddings.

### 13.4 Outcome (2026-07-02): shipped the lexical alternative

The maintainer chose the no-dependency lexical path. Semantic recall stays `blocked` above as a
future direction; the FTS5/BM25 upgrade was implemented instead:

- **Migration 4 (`recall_fts5_index`)** in `src/core/db/schema.ts`: an FTS5 virtual table
  (`recall_fts`, `trigram` tokenizer) over the keyword-recall corpus (session summaries +
  Decision/Skill events), kept in sync by triggers, with a one-time backfill for existing rows.
- **`recallKeyword`** in `src/core/db/recall.ts` now runs FTS5 `MATCH` + `bm25()` ranking as the
  primary path, mapping bm25 into the existing time-decay envelope, and falls back to the
  original `LIKE` scan for sub-trigram (1–2 char) / CJK-short queries and any FTS miss — so
  behaviour is a strict superset with no regression. Verified against a populated pre-migration
  DB (backfill) and via `scripts/test-smoke.sh` (multi-word bm25 hit + CJK fallback assertions).
