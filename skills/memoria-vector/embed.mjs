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

/** Test seam: install a stand-in for the transformers pipeline so batching can be asserted without
 *  the model. Same call shape — (texts, options) => { dims: [n, DIM], data: Float32Array }. */
export function setLocalPipelineForTest(pipeline) {
  localPipeline = pipeline
}

async function embedLocal(texts, kind) {
  if (!localPipeline) {
    let transformers
    try {
      transformers = await import('@huggingface/transformers')
    } catch {
      // Name the cause, not just the cure (issue-11). This dependency is a devDependency on purpose
      // — it is ~850MB, and a stub-only user should not pay for it — but `local` is the DEFAULT
      // provider, so the standard production install recipes are exactly the ones that break it.
      // The previous wording said "run npm install", which reads as a contradiction to someone who
      // just ran npm install (with --omit=dev) and watched it succeed.
      throw new Error(
        'MEMORIA_EMBED_PROVIDER=local requires @huggingface/transformers, which is a devDependency ' +
        'of this helper — `npm install --omit=dev` and NODE_ENV=production both skip it, which is ' +
        'the usual reason it is missing here. Run `npm install` WITHOUT --omit=dev inside ' +
        'skills/memoria-vector, or set MEMORIA_EMBED_PROVIDER=stub (no model download, no semantic quality).'
      )
    }
    localPipeline = await transformers.pipeline('feature-extraction', MODEL, { dtype: 'q8' })
  }
  const prefix = kind === 'query' ? 'query: ' : 'passage: '
  // One pipeline call per batch (issue-19). Every row in a call is padded to the longest one and the
  // intermediate tensors scale with rows × length, so handing the whole corpus over at once grew a
  // single process to 21.9GB at 771 entities and got it OOM-killed; batches of 32 in one process
  // peaked at ~2.5GB whether the corpus was 400 or 1600 entities. A single text (every recall query)
  // never reads MEMORIA_EMBED_BATCH, so a bad ingest-only setting cannot break semantic recall.
  const batchSize = texts.length > 1 ? resolveBatchSize() : 1
  const vectors = []
  for (let start = 0; start < texts.length; start += batchSize) {
    const batch = texts.slice(start, start + batchSize)
    const out = await localPipeline(batch.map((t) => prefix + t), { pooling: 'mean', normalize: true })
    const [n, dim] = [out.dims[0], out.dims[1]]
    if (dim !== DIM) throw new Error(`Model dim ${dim} != expected ${DIM}`)
    for (let i = 0; i < n; i++) vectors.push(Array.from(out.data.slice(i * dim, (i + 1) * dim)))
  }
  return vectors
}

const DEFAULT_EMBED_BATCH = 32

function resolveBatchSize() {
  const raw = process.env.MEMORIA_EMBED_BATCH?.trim()
  if (!raw) return DEFAULT_EMBED_BATCH
  const size = Number(raw)
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error(`MEMORIA_EMBED_BATCH must be a positive integer, got '${raw}'`)
  }
  return size
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
