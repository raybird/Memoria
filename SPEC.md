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
- SQLite persistence (`sessions`, `events`, `skills`, `memory_nodes`, `memory_node_sources`, `memory_sync_state`, `recall_telemetry`)
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
  - `recall` supports `mode: keyword | tree | hybrid`
  - recall metadata includes `reasoning_path`, `route_mode`, `fallback_used`
- Adaptive retrieval gate:
  - skips trivial/greeting recall requests when no explicit recall mode or memory intent is present
  - telemetry records skipped requests with `route_mode=skipped`
- Governance review:
  - deterministic review queue for repeated decisions / skills
  - exposed via `memoria govern review`
- Time-decay recall scoring:
  - `scoreNode()` applies `1 / (1 + ageDays / halfLife)` decay (halfLife=90 days)
  - `recallKeyword()` computes per-result relevance scores (token match × decay)
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
- Built-in semantic/vector retrieval engine inside Memoria core
- First-party OpenCode plugin implementation

## Architectural Non-Goals

To preserve Memoria's local-first and explainable design, these are explicit non-goals for the core system today:

- Embedding-first / rerank-heavy retrieval as a required dependency for baseline recall
- Turning MCP/libSQL or any external vector store into the source-of-truth datastore
- Deep coupling to a single agent runtime's internal plugin lifecycle
- Large retrieval config surfaces that make the default install hard to understand or operate
- Replacing auditable SQLite + markdown memory with opaque ranking-only infrastructure

Those items are tracked in planning docs (`RFC.md`, legacy spec notes).
