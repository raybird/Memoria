# memoria-vector — optional semantic-recall helper

> **This is not an Agent Skill.** It sits under `skills/` next to one (`memoria-memory-sync`, which
> has a `SKILL.md` and is deployed by `memoria setup`), but it is a plain Node package with its own
> `package.json` and dependencies, spawned as a subprocess and never read by an agent. There is no
> `SKILL.md` here and there should not be one. The directory holds two different kinds of thing;
> only the other one is a skill.

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

First `local` embedding downloads the model (~120MB). transformers.js caches it inside its own
package — `node_modules/@huggingface/transformers/.cache/` here, not a per-user cache directory — so
removing this `node_modules` removes the model too.
CI installs with `--omit=dev` and runs the deterministic `stub` provider instead.

> **A global `npm i -g` upgrade of memoria wipes this directory's `node_modules`, model included.**
> The helper ships inside the package, and npm replaces the whole package directory on upgrade, so
> semantic recall quietly falls back to lexical results until you reinstall here. After each upgrade,
> run `npm install` in this directory again, then — with `LIBSQL_URL` set — warm the model once with
> `echo '{"query":"warm up"}' | node vector-recall.mjs` — the first run after a reinstall can take
> longer than the recall timeout (`route_mode: vector_timeout`). `memoria doctor` names both steps.

> **`--omit=dev` and `NODE_ENV=production` produce a helper that cannot embed.**
> `@huggingface/transformers` is a **devDependency** — deliberately, because it is ~850MB and a
> `stub`-only user should not pay for it — while `local` is the **default** provider. So the standard
> production install recipes install cleanly and then fail at the first query. If that is the setup
> you want, either install without `--omit=dev`, or set `MEMORIA_EMBED_PROVIDER=stub` and accept that
> there is no semantic quality behind it. `memoria doctor` reports this state directly (v1.26.0+),
> except when `MEMORIA_VECTOR_RECALL_CMD` points at a helper it does not own — it says so rather than
> guessing.

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
- `MEMORIA_EMBED_BATCH` — texts per local-model call during ingest (default 32). Peak memory follows the batch, not the corpus: at 32 one ingest process peaked at ~2.5GB for 400 to 1600 entities alike, while one call over 771 entities reached 21.9GB and was OOM-killed (issue-19). Lower it on small machines. Only multi-text calls read it — a single recall query is unaffected, even by an invalid value
- `MEMORIA_VECTOR_ENABLE=1` — lets `run-sync-with-enhancement.sh` embed each sync's payload
- `MEMORIA_VECTOR_TIMEOUT_MS` — recall-side helper timeout (default 4000; spawn-per-query measured ~1s warm-cache)
- `MEMORIA_VECTOR_RECALL_CMD` — override the recall helper script path (tests)

## Model choice (2026-07-07 spike)

`multilingual-e5-small` scored 5/6 on a hard Traditional-Chinese/English/cross-lingual
discrimination set (English-only `all-MiniLM-L6-v2`: 2/6, cross-lingual total failure).
E5's cosine range is compressed — ranking must be positional (Memoria fuses with RRF),
never a raw-cosine threshold.
