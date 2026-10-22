# HTTP API Reference

**English** ｜ [繁體中文](API.zh-TW.md) · [README](../README.md)

Last verified: 2026-10-23 against v1.31.1 source, CLI help and documentation checks.

This is the local HTTP interface. See the [Install Guide](INSTALL.md) for startup and background service options.

## Quick start

```bash
memoria serve --port 3917
```

In another terminal, check health and recall memories:

```bash
curl -sf http://localhost:3917/v1/health
curl -sS -X POST http://localhost:3917/v1/recall \
  -H 'Content-Type: application/json' \
  -d '{"query":"SQLite migration","top_k":5,"project":"Memoria"}'
```

`POST /v1/remember` accepts a complete SessionData object; see [session.sample.json](../examples/session.sample.json). For an atomic text note, use [CLI remember](CLI.md).

## Endpoints and response format

Launch: `memoria serve` (port 3917, override via `MEMORIA_PORT`).

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/v1/health` | Health check |
| `GET`  | `/v1/stats` | Statistics |
| `GET`  | `/v1/telemetry/recall` | Recall routing telemetry + confidence×utility calibration (query: `window`, `limit`) |
| `GET`  | `/v1/brief` | Compiled brief — structured data **and** rendered markdown (query: `project`, `days`, `top_k`); never writes `BRIEF.md` |
| `POST` | `/v1/remember` | Write memory (body: SessionData; optional `scope`) |
| `POST` | `/v1/recall` | Recall memories (body: `{query, top_k?, project?, scope?, mode?}`; `mode:'vector'` = opt-in semantic recall, needs `LIBSQL_URL` + `skills/memoria-vector`, degrades to lexical) |
| `POST` | `/v1/recall/:id/outcome` | Report recall utility (body: `{signal, utility_score?, used?, hits?}`; UFL write-back + per-memory attribution) |
| `POST` | `/v1/sources` | Import a markdown/text source |
| `GET`  | `/v1/sources` | List raw sources |
| `POST` | `/v1/wiki/build` | Rebuild compiled wiki special pages |
| `POST` | `/v1/wiki/file-query` | File a high-value query back into a wiki page |
| `POST` | `/v1/wiki/lint` | Run wiki governance lint |
| `GET`  | `/v1/sessions/:id/summary` | Session summary |
| `POST` | `/v1/repos` | Register a git repository for read-only observation |
| `GET`  | `/v1/repos` | List observed repositories |
| `GET`  | `/v1/repos/:ref/status` | Registry + live git state |
| `POST` | `/v1/repos/:ref/sync` | Incremental git scan (`{generate_summaries?, dry_run?, ...}`) |
| `POST` | `/v1/repos/:ref/summarize` | Summarize branch/range/merge/tag |
| `GET`  | `/v1/repos/:ref/summaries/pending` | Summaries awaiting agent enrichment |
| `POST` | `/v1/repos/:ref/summaries/:summaryId` | Agent summary write-back |
| `POST` | `/v1/repos/:ref/summaries/:summaryId/dismiss` | Skip a pending summary (not auto-promoted; a later `--submit` or an explicit `--promote` can still put it in recall; `409` if it is enriched or already in recall) |
| `POST` | `/v1/repos/:ref/summaries/dismiss` | Skip pending summaries by `{types}`; ones already in recall are skipped (`skipped_promoted`) |

All responses use the `MemoriaResult<T>` envelope (`evidence[]`, `confidence`, `latency_ms`).

`confidence` is `0–1` **or `null`**, and recall responses carry `confidence_basis` naming where the
value came from: `lexical_coverage` (query-token coverage of the top hit), `no_hits` (nothing
matched — `confidence` is `0`), or `unavailable` (the top hit came from the semantic index alone, so
match quality is not measurable — `confidence` is `null`, which means "cannot judge", not "poor
match"). Only the opt-in vector route ever produces `null`.
