# Memoria Specification (Implemented)

This document is the source of truth for what Memoria currently implements.

## Implemented Scope

- TypeScript CLI commands:
  - `init`
  - `sync` (`--dry-run`)
  - `stats`
  - `doctor`
  - `verify` (`--json`)
  - `index build`
  - `govern review`
  - `prune`
  - `export`
- SQLite persistence (`sessions`, `events`, `skills`, `memory_nodes`, `memory_node_sources`, `memory_sync_state`, `recall_telemetry`, `memory_utility`)
- Lightweight scope isolation:
  - `SessionData.scope` optional at write time
  - if omitted, scope defaults to `project:<project>` or `global`
  - `recall` and `index build` support scope filtering
- Markdown sync outputs:
  - `knowledge/Daily/`
  - `knowledge/Decisions/`
  - `knowledge/Skills/`
- Path overrides via environment variables:
  - `MEMORIA_DB_PATH`
  - `MEMORIA_SESSIONS_PATH`
  - `MEMORIA_CONFIG_PATH`
- Deterministic fallback IDs for idempotent re-sync behavior
- Memory-quality guardrails during import:
  - exact duplicate events within the same session are suppressed before persistence
  - trivial session summaries are replaced with the first higher-signal event text when available
- Tree memory index build and recall modes:
  - `recall` supports `mode: keyword | tree | hybrid | vector`
  - recall metadata includes `reasoning_path`, `route_mode`, `fallback_used`, `recall_id`
- Recall utility feedback loop (UFL):
  - every successful `recall()` carries `meta.recall_id`
  - `POST /v1/recall/:id/outcome` (`{signal, utility_score?, used?, hits?}`) writes observed utility back to `recall_telemetry`; `hits[]` attributes it per memory into `memory_utility`
  - `signal:'explicit'` (SDK `markRecallUseful`) accumulates separately from the lexical-reuse proxy and overrides it (`effectiveUtility`: explicit needs 1 observation, reuse needs 2)
  - utility-weighted ranking: accrued per-memory utility down-weights recall `score` (factor ∈ [0.5, 1], never boosts); byte-identical with no observations
  - utility-weighted retention: `prune --stale-days` spares memories with effective utility ≥ 0.5; `--consolidate-days` keeps the highest-utility child (falls back to newest)
  - confidence×utility calibration (buckets + monotonicity flag) exposed in `stats.recallRouting.calibration` and `GET /v1/telemetry/recall`, hidden until outcomes exist; adapters report reuse outcomes automatically (fail-open)
- Semantic recall (`mode:'vector'`, opt-in):
  - gated by `LIBSQL_URL` + the out-of-core `skills/memoria-vector` helper (spawned via `node:child_process`; core gains no runtime dependency)
  - local embeddings (`multilingual-e5-small` q8 by default; `MEMORIA_EMBED_PROVIDER=local|stub`), vectors stored as libSQL native `F32_BLOB` + `vector_top_k`
  - lexical floor always runs; results fuse via Reciprocal Rank Fusion; authoritative fields re-read from local SQLite
  - fail-open degradation: `route_mode = vector_unavailable | vector_timeout | keyword | hybrid_vector | vector`; `MEMORIA_VECTOR_TIMEOUT_MS` (default 4000) bounds the helper
  - sync-flow ingest step behind `MEMORIA_VECTOR_ENABLE=1` (default off)
- Adaptive retrieval gate:
  - skips trivial/greeting recall requests when no explicit recall mode or memory intent is present
  - telemetry records skipped requests with `route_mode=skipped`
- Governance review:
  - deterministic review queue for repeated decisions / skills
  - exposed via `memoria govern review`
- Time-decay recall scoring:
  - `scoreNode()` applies `1 / (1 + ageDays / halfLife)` decay (halfLife=90 days)
  - `recallKeyword()` ranks with SQLite FTS5 + `bm25()` over a `trigram`-indexed corpus (× decay), falling back to a `LIKE` scan for sub-trigram / CJK-short queries and any FTS miss
  - recall hit tracking: `recallTree` updates `last_synced_at` on matched nodes
- Prune memory management:
  - `--consolidate-days <N>`: merges old session nodes under same topic
  - `--stale-days <N>`: removes never-recalled nodes and orphan sessions
  - `--all` includes consolidate (90d) and stale (180d) by default
- Recall routing observability:
  - aggregated in `stats.recallRouting`
  - raw endpoint: `GET /v1/telemetry/recall?window=P7D&limit=100`
- Optional MCP/libSQL enhancement flow:
  - bridge payload generation
  - request bundle generation
  - auto-ingest with strict/non-strict mode
  - incremental cursor tracking via `memory_sync_state`
  - payload modes: `incremental` (default) / `full`

## Validation Commands

```bash
pnpm run check
pnpm run build
node dist/cli.mjs --help
bash scripts/test-smoke.sh
bash scripts/test-mcp-e2e.sh
```

## Added in Phase 1 & 1.5 (2026-02-23)

- `src/core/` library: `types`, `paths`, `utils`, `db`, `memoria`, `index`
- `MemoriaCore` class: `remember()`, `recall()`, `summarizeSession()`, `health()`, `stats()`
- `MemoriaResult<T>` response envelope with `evidence[]`, `confidence`, `source`, `latency_ms`
- HTTP API server (`src/server.ts`, node:http): 6 endpoints on default port 3917
- Node.js SDK client (`src/sdk.ts`): `MemoriaClient` with `waitUntilReady()`
- CLI refactored to thin shell; new commands: `serve`, `preflight`, `setup`
- `--json` flag added to all major commands
- Bootstrap test: `scripts/test-bootstrap.sh`

## Out of Scope (Current)

- Built-in context condensation engine
- Semantic/vector retrieval engine **inside Memoria core** (shipped instead as the opt-in out-of-core `skills/memoria-vector` helper — core stays dependency-free; see `mode:'vector'` above)
- First-party OpenCode plugin implementation

## Architectural Non-Goals

To preserve Memoria's local-first and explainable design, these are explicit non-goals for the core system today:

- Embedding-first / rerank-heavy retrieval as a required dependency for baseline recall
- Turning MCP/libSQL or any external vector store into the source-of-truth datastore
- Deep coupling to a single agent runtime's internal plugin lifecycle
- Large retrieval config surfaces that make the default install hard to understand or operate
- Replacing auditable SQLite + markdown memory with opaque ranking-only infrastructure

Those items are tracked in planning docs (`RFC.md`, legacy spec notes).
