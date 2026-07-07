# RFC: Semantic Recall Loop

- Status: `phase-1-shipped` — unblocked 2026-07-07 by the embedding-backend decision (§14): local `multilingual-e5-small` via an out-of-core helper, vectors in libSQL native `F32_BLOB`. MVP shipped: `mode: 'vector'` = lexical floor + `vector_top_k` + RRF fusion, fully fail-open, Memoria-only untouched. See [§14](#14-phase-0-spike--mvp-delivery-2026-07-07).
- Created: 2026-07-02
- Updated: 2026-07-07 (Phase 0' spike + MVP delivery)
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

## 14. Phase 0' Spike + MVP Delivery (2026-07-07)

### 14.1 Embedding-backend decision（解鎖 §13.3 的 blocked）

維護者拍板：**本地模型、libSQL 原生向量、選用模式**。兩軸 spike 實測（詳見 `skills/memoria-vector/README.md`）：

- **Embedding 來源 = local `Xenova/multilingual-e5-small`（q8）**。以 Memoria 真實語料形態（繁中技術摘要、中英混合、跨語言、字面完全不相交的語意配對）測 6 題困難集：e5-small **5/6**、paraphrase-multilingual 4/6、英文 all-MiniLM-L6-v2 **2/6（跨語言全滅）**。單筆推理 ~3ms、已快取冷啟動 ~950ms → **spawn-per-query 即可行，原 Phase 2 的長駐 pooling 機制整個免掉**。已知怪癖：e5 cosine 區間壓縮（0.79–0.86），**只能按名次排序（RRF），不可用絕對分數當門檻**——與 §5b 的 RRF 設計天然互補。hosted API（無 key 可測，桌面對照）成本非差異點（~$0.01/月），**隱私才是**：記憶內容不出機器，與 local-first 立場一致。provider 抽象（`MEMORIA_EMBED_PROVIDER=local|stub`）保留未來 hosted 的插槽。
- **向量存放 = libSQL 原生 `F32_BLOB(384)` + `vector_top_k`**（實測 `file:` 模式 ANN 索引 + rowid join 全數可用）。沿用 `LIBSQL_URL` 選用 gating——語意召回定位為 **MCP/libSQL 選用模式的增強層**；`mcp-memory-libsql`（純文字搜尋，§13.2）被繞過，helper 直接對 libSQL 讀寫。
- **重依賴不進 core**：`skills/memoria-vector/` 自帶 package.json（`@libsql/client` 為 deps；`@huggingface/transformers` ~700MB 在 devDeps，使用者 `npm install` 一步到位，CI `--omit=dev` 只拿 24MB），core 以 `node:child_process` spawn，零新增 runtime 依賴。

### 14.2 MVP 交付

- **Helper**（`skills/memoria-vector/`）：`embed.mjs`（provider 抽象）、`vector-ingest.mjs`（bridge payload → 向量 upsert，離線路徑；`project:`/`skill_profile` 實體不嵌入）、`vector-recall.mjs`（query → `vector_top_k` → 前綴 id 名單）。
- **Core**（`src/core/recall-vector.ts`）：`recallVector`（spawn + `MEMORIA_VECTOR_TIMEOUT_MS` 預設 4000ms + 降級狀態機）與 `rrfFuse`（k=60，穩定排序、tie 偏向 lexical）。§5a 前綴映射照設計實作：所有欄位從本地 SQLite **權威回讀**，`skill:<slug>` 經 SkillLearned 事件 slug 對照，未知/過期 id 靜默丟棄，project/scope/time_window 過濾在本地回讀時強制。
- **`recall()`**：`mode:'vector'` 分支 = keyword floor + 向量融合；`vector` 不走 tree。降級矩陣（§6）完整：`vector_unavailable` / `vector_timeout` / ok+0hits→`keyword` / `hybrid_vector` / `vector`。**既有 keyword/tree/hybrid/skip 分支經 envelope 前後比對逐位元一致**（僅 time-decay 時間噪音）。
- **邊界**：`recallModeSchema` 加 `'vector'`；`RecallFilter.mode`/`FileQueryInput.mode`；routeCounts 加 4 個 vector 計數；`memoria stats` 僅在有 vector 使用時多顯示一行。
- **Ingest 接線**：`run-sync-with-enhancement.sh` 加 `MEMORIA_VECTOR_ENABLE=1` 選用步驟（預設關，fail-open）。
- **測試**（`scripts/test-vector-recall.sh`，掛 CI http-mcp 組，stub provider 免下載模型）：語意面（向量召回字面召不到的記憶）、權威回讀（snippet 來自本地 summary 而非 libSQL 副本）、過期 id 丟棄、project 過濾、`vector_unavailable`/`vector_timeout` 降級、stats 計數。`MEMORIA_VECTOR_E2E_REAL=1` 加跑真模型「字面不相交語意召回」斷言（已於交付時通過：`money planning and financial projections` → `Q3 budget and revenue forecast`）。

### 14.3 與 UFL 的匯合（戰略閉環）

recall_id 對 vector 模式照常發放 → UFL 的 reuse/explicit 回饋照常寫回 → **`route_mode` 分組比較 utility uplift 即可客觀量測「語意是否勝過字面」**（§1 的死結正式解掉）。接續（原 Phase 2/3 殘餘）：hybrid 模式的向量融合、telemetry 校準分組呈現、語意去重——皆待真實 uplift 資料說話後再動。
