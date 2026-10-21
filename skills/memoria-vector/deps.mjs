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
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HELPER_DIR = dirname(fileURLToPath(import.meta.url))

export function vectorCacheRoot(env = process.env) {
  const base = env.XDG_CACHE_HOME?.trim() || join(homedir(), '.cache')
  return join(base, 'memoria', 'vector')
}

export function lockHash(helperDir = HELPER_DIR) {
  return createHash('sha256').update(readFileSync(join(helperDir, 'package-lock.json'))).digest('hex').slice(0, 16)
}

/** The cache directory this helper's dependency set installs into — whether or not it exists yet.
 *  null when the helper was copied without its lockfile and so cannot name one. */
export function cacheDirFor(helperDir = HELPER_DIR, env = process.env) {
  if (!existsSync(join(helperDir, 'package-lock.json'))) return null
  return join(vectorCacheRoot(env), lockHash(helperDir))
}

/** { source: 'sibling' | 'cache' | 'none', dir, modelCacheDir, cacheDir } — modelCacheDir is null
 *  unless the dependencies come from the cache, so the sibling case keeps transformers.js's own
 *  default; cacheDir is where `setup --vector` installs for this lockfile. */
export function resolveDepsLocation(helperDir = HELPER_DIR, env = process.env) {
  const cacheDir = cacheDirFor(helperDir, env)
  if (existsSync(join(helperDir, 'node_modules'))) {
    return { source: 'sibling', dir: helperDir, modelCacheDir: null, cacheDir }
  }
  if (cacheDir !== null && existsSync(join(cacheDir, '.complete'))) {
    return { source: 'cache', dir: cacheDir, modelCacheDir: join(vectorCacheRoot(env), 'models'), cacheDir }
  }
  return { source: 'none', dir: null, modelCacheDir: null, cacheDir }
}

let location = null

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
// argv[1] is whatever the caller passed (`node -e '…' foo` makes it "foo"), so a path that does not
// resolve must mean "not run directly" rather than throw out of every import of this module.
function runDirectly() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}
if (runDirectly()) {
  process.stdout.write(JSON.stringify(resolveDepsLocation()) + '\n')
}
