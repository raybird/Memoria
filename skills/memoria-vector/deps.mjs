// Where this helper's dependencies (and, with them, the local model cache) live (issue-25).
//
// The helper ships inside the globally installed memoria package, and `npm i -g` replaces that whole
// directory on every upgrade — a node_modules installed next to this file disappears with it, the
// ~120MB model cache too (transformers.js keeps it inside its own package dir). So, in order:
//
//   sibling — a node_modules next to this file. A developer checkout, or a downstream image that
//             bundles the helper with its own dependencies (HANDOVER §8: one does, read-only, at a
//             hard-coded path). Loaded exactly as before, model cache left at transformers.js's
//             default, so those setups see no change at all.
//   cache   — ${XDG_CACHE_HOME:-~/.cache}/memoria/vector/<hash>, written by `memoria setup --vector`.
//             <hash> comes from this helper's package-lock.json: an upgrade with the same lockfile
//             finds the same directory, one with a different lockfile gets a fresh one instead of
//             loading dependencies it was not built against. Only a directory carrying `.complete`
//             counts, so an interrupted install never looks installed.
//   none    — neither; imports fail as they always did, and embed.mjs names the remedy.
//
// The cache path resolves entry points with Node's own resolver (createRequire → the `require`
// export condition) rather than hand-parsing `exports`; both dependencies ship a CommonJS build.
// Measured on Node 18.18 and 22.20 before this was written (issue-25 S0).

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HELPER_DIR = dirname(fileURLToPath(import.meta.url))

function vectorCacheRoot(env = process.env) {
  // XDG says a relative XDG_CACHE_HOME is invalid and must be ignored; honouring it would resolve
  // against each process's own cwd, so setup and recall could disagree about the directory.
  const xdg = env.XDG_CACHE_HOME?.trim()
  const base = xdg && isAbsolute(xdg) ? xdg : join(homedir(), '.cache')
  return join(base, 'memoria', 'vector')
}

/** Where transformers.js keeps the model when the dependencies come from the cache. */
export function modelCacheDirFor(env = process.env) {
  return join(vectorCacheRoot(env), 'models')
}

function lockHash(helperDir) {
  return createHash('sha256').update(readFileSync(join(helperDir, 'package-lock.json'))).digest('hex').slice(0, 16)
}

/** The cache directory this helper's dependency set installs into — whether or not it exists yet.
 *  null when the helper was copied without its lockfile and so cannot name one. */
function cacheDirFor(helperDir, env) {
  if (!existsSync(join(helperDir, 'package-lock.json'))) return null
  return join(vectorCacheRoot(env), lockHash(helperDir))
}

/** { source: 'sibling' | 'cache' | 'none', dir, modelCacheDir, cacheDir } — modelCacheDir is null
 *  unless the dependencies come from the cache, so the sibling case keeps transformers.js's own
 *  default; cacheDir is where `setup --vector` installs for this lockfile. */
export function resolveDepsLocation(helperDir = HELPER_DIR, env = process.env) {
  if (existsSync(join(helperDir, 'node_modules'))) {
    // The sibling path never needs the cache, so nothing it newly depends on (a home directory, a
    // readable lockfile) may break it: cacheDir is only informational here (review 1ffc3a2 S-3).
    let cacheDir = null
    try { cacheDir = cacheDirFor(helperDir, env) } catch {}
    return { source: 'sibling', dir: helperDir, modelCacheDir: null, cacheDir }
  }
  const cacheDir = cacheDirFor(helperDir, env)
  if (cacheDir !== null && existsSync(join(cacheDir, '.complete'))) {
    return { source: 'cache', dir: cacheDir, modelCacheDir: modelCacheDirFor(env), cacheDir }
  }
  return { source: 'none', dir: null, modelCacheDir: null, cacheDir }
}

let location = null

/** Pin the location instead of resolving it. `setup --vector` warms the model against the install it
 *  has just staged — not yet marked complete, and possibly shadowed by a sibling node_modules — so the
 *  warm-up exercises exactly the directory that will be marked. */
export function useDepsLocation(pinned) {
  location = pinned
}

/** Import one dependency from wherever resolveDepsLocation points. Returns the module's exports
 *  (for the CommonJS build loaded from the cache, its module.exports). */
export async function importDep(name) {
  location ??= resolveDepsLocation()
  if (location.source !== 'cache') return import(name)
  const entry = createRequire(join(location.dir, 'package.json')).resolve(name)
  const mod = await import(pathToFileURL(entry).href)
  return mod.default ?? mod
}

export function depsLocation() {
  location ??= resolveDepsLocation()
  return location
}

// `node deps.mjs` prints the resolution as JSON. doctor and `setup --vector` ask this file instead of
// re-deriving the hash, so the lockfile → directory rule has exactly one implementation.
// Under `node -e '…' a b` there is no main script and argv[1] is just "a" — possibly this very file's
// path, which must not make an importer print JSON onto its own stdout (review 1ffc3a2 N-7). A path
// that does not resolve means "not run directly" rather than a throw out of every import.
function runDirectly() {
  if (process.execArgv.some((a) => /^(-e|--eval|-p|--print)(=|$)/.test(a))) return false
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}
if (runDirectly()) {
  process.stdout.write(JSON.stringify(resolveDepsLocation()) + '\n')
}
