// Embedding provider abstraction for the Memoria vector helper.
//
// Providers (env MEMORIA_EMBED_PROVIDER, default 'local'):
//   local — Xenova/multilingual-e5-small (q8) via @huggingface/transformers. Chosen by the
//           2026-07-07 spike: 5/6 on a hard Traditional-Chinese + English + cross-lingual
//           discrimination set (vs 2/6 for the English-only all-MiniLM-L6-v2), ~950ms cached
//           cold load, ~3ms/inference. E5 requires "query: " / "passage: " prefixes, and its
//           cosine range is compressed — callers must rank (RRF), never threshold on raw cosine.
//   stub  — deterministic char-trigram hash vectors. No model download; used by CI to test the
//           full embed→store→top_k→map→fuse plumbing without @huggingface/transformers.
//
// All providers emit DIM-dimensional L2-normalized Float32 vectors so the libSQL table schema
// (F32_BLOB(DIM)) is provider-independent.

export const DIM = 384

const MODEL = process.env.MEMORIA_EMBED_MODEL?.trim() || 'Xenova/multilingual-e5-small'

let localPipeline = null

async function embedLocal(texts, kind) {
  if (!localPipeline) {
    let transformers
    try {
      transformers = await import('@huggingface/transformers')
    } catch {
      throw new Error(
        'MEMORIA_EMBED_PROVIDER=local requires @huggingface/transformers — run `npm install` inside skills/memoria-vector, or set MEMORIA_EMBED_PROVIDER=stub.'
      )
    }
    localPipeline = await transformers.pipeline('feature-extraction', MODEL, { dtype: 'q8' })
  }
  const prefix = kind === 'query' ? 'query: ' : 'passage: '
  const out = await localPipeline(texts.map((t) => prefix + t), { pooling: 'mean', normalize: true })
  const [n, dim] = [out.dims[0], out.dims[1]]
  if (dim !== DIM) throw new Error(`Model dim ${dim} != expected ${DIM}`)
  return Array.from({ length: n }, (_, i) => Array.from(out.data.slice(i * dim, (i + 1) * dim)))
}

// Deterministic pseudo-embedding: hash character trigrams into DIM buckets, L2-normalize.
// Overlapping trigrams => nearby vectors, so "quantum flux" lands close to a stored
// "quantum flux capacitor" — enough to drive the plumbing end-to-end in tests.
function stubVec(text) {
  const v = new Array(DIM).fill(0)
  const s = `  ${String(text).toLowerCase()}  `
  for (let i = 0; i < s.length - 2; i++) {
    let h = 2166136261
    for (let j = i; j < i + 3; j++) {
      h ^= s.charCodeAt(j)
      h = Math.imul(h, 16777619)
    }
    v[(h >>> 0) % DIM] += 1
  }
  const norm = Math.sqrt(v.reduce((acc, x) => acc + x * x, 0)) || 1
  return v.map((x) => x / norm)
}

/** Embed texts as 'query' or 'passage'. Returns number[][] (length DIM, L2-normalized). */
export async function embedTexts(texts, kind) {
  const provider = (process.env.MEMORIA_EMBED_PROVIDER ?? 'local').trim()
  if (provider === 'stub') return texts.map(stubVec)
  if (provider === 'local') return embedLocal(texts, kind)
  throw new Error(`Unknown MEMORIA_EMBED_PROVIDER: ${provider} (expected 'local' or 'stub')`)
}
