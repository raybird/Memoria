# memoria-vector — optional semantic-recall helper

Gives Memoria's `recall({ mode: 'vector' })` a real semantic index: memories are embedded locally
and stored as libSQL **native vectors** (`F32_BLOB` + `vector_top_k`), then queried at recall time.
See `docs/RFC-semantic-recall.md` for the full design and the Phase 0'/spike evidence.

Deliberately **outside Memoria's core dependencies** — core spawns these scripts via
`node:child_process` and stays dependency-free. Memoria-only mode (no `LIBSQL_URL`) is untouched:
`mode: 'vector'` then degrades to lexical recall (`route_mode: vector_unavailable`).

## Install

```bash
cd skills/memoria-vector
npm install          # @libsql/client + @huggingface/transformers (local embedding runtime)
```

First `local` embedding downloads the model (~120MB, cached under `~/.cache/huggingface`).
CI installs with `--omit=dev` and runs the deterministic `stub` provider instead.

## Scripts

| Script | Role |
|--------|------|
| `embed.mjs` | Provider abstraction: `local` (default, `Xenova/multilingual-e5-small` q8) or `stub` (deterministic, tests) |
| `vector-ingest.mjs <bridge-payload.json>` | Embed a MCP-bridge payload's entities → upsert `memoria_vectors` in libSQL (offline path) |
| `vector-recall.mjs` | stdin `{query, topK}` → embed query → `vector_top_k` → stdout `{hits:[{name,kind,distance}]}` |

## Env

- `LIBSQL_URL` (required) / `LIBSQL_AUTH_TOKEN` — same gate as the MCP/libSQL enhancement layer
- `MEMORIA_EMBED_PROVIDER` — `local` (default) | `stub`
- `MEMORIA_EMBED_MODEL` — override the local model (must emit 384-dim vectors)
- `MEMORIA_VECTOR_ENABLE=1` — lets `run-sync-with-enhancement.sh` embed each sync's payload
- `MEMORIA_VECTOR_TIMEOUT_MS` — recall-side helper timeout (default 4000; spawn-per-query measured ~1s warm-cache)
- `MEMORIA_VECTOR_RECALL_CMD` — override the recall helper script path (tests)

## Model choice (2026-07-07 spike)

`multilingual-e5-small` scored 5/6 on a hard Traditional-Chinese/English/cross-lingual
discrimination set (English-only `all-MiniLM-L6-v2`: 2/6, cross-lingual total failure).
E5's cosine range is compressed — ranking must be positional (Memoria fuses with RRF),
never a raw-cosine threshold.
