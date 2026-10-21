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

For a global install of memoria:

```bash
memoria setup --vector     # MEMORIA_HOME set, or pass --memoria-home: setup also initializes the data root
```

It installs this helper's dependencies into `${XDG_CACHE_HOME:-~/.cache}/memoria/vector/<hash>/`,
where `<hash>` comes from this directory's `package-lock.json`, downloads the model (~120MB) into
`${XDG_CACHE_HOME:-~/.cache}/memoria/vector/models/`, and warms it once — the first load can take
longer than the recall timeout (`route_mode: vector_timeout`), so setup pays it instead of your first
recall (issue-25). A global `npm i -g` upgrade replaces this directory but not the cache: an upgrade
that keeps the same lockfile needs nothing, and one that changes it resolves to a new hash, so
`memoria doctor` reports the embedder missing and `setup --vector` installs the new set. Old hash
directories (~720MB each) are not cleaned up; delete one when no installed version uses it.
With `MEMORIA_EMBED_PROVIDER=stub`, `setup --vector` installs only `@libsql/client` and skips the model.

From a checkout, or for an image that bundles the helper:

```bash
cd skills/memoria-vector
npm install          # @libsql/client + @huggingface/transformers (local embedding runtime)
```

A `node_modules` beside the helper always wins over the cache and loads exactly as it did before
issue-25: transformers.js then keeps the model inside its own package —
`node_modules/@huggingface/transformers/.cache/` here — so removing this `node_modules` removes the
model too. `deps.mjs` holds the resolution order; `node deps.mjs` prints which location applies.
CI installs with `--omit=dev` and runs the deterministic `stub` provider instead.

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
| `deps.mjs` | Where the dependencies load from: a sibling `node_modules`, else the user cache `setup --vector` fills (keyed by `package-lock.json`); `node deps.mjs` prints the resolution |
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
