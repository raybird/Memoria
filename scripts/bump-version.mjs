#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { argv, exit } from 'node:process'

const usage = `Usage: node scripts/bump-version.mjs <patch|minor|major|x.y.z>

Updates version in:
  - package.json (source of truth; CLI reads it via esbuild define at build time)
  - install.sh (v... header + VERSION="...")
  - skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md (version: "...")
  - docs/INSTALL.md (v... in install commands)
`

const level = argv[2]
if (!level) { console.error(usage); exit(1) }

const pkg = JSON.parse(await readFile('package.json', 'utf8'))
const [maj, min, pat] = pkg.version.split('.').map(Number)

let next
if (level === 'patch') next = `${maj}.${min}.${pat + 1}`
else if (level === 'minor') next = `${maj}.${min + 1}.0`
else if (level === 'major') next = `${maj + 1}.0.0`
else if (/^\d+\.\d+\.\d+$/.test(level)) next = level
else { console.error(`Invalid level: ${level}\n${usage}`); exit(1) }

const oldV = pkg.version
console.log(`Bumping ${oldV} → ${next}`)

async function patch(file, transform) {
  const src = await readFile(file, 'utf8')
  const out = transform(src)
  if (out === src) {
    // A no-op means the expected version string drifted — fail loudly rather than
    // leaving some files bumped and others stale.
    console.error(`  ✗ ${file}: expected to change but did not (version string not found?)`)
    exit(1)
  }
  await writeFile(file, out)
  console.log(`  ✓ ${file}`)
}

pkg.version = next
await writeFile('package.json', JSON.stringify(pkg, null, 2) + '\n')
console.log(`  ✓ package.json`)

await patch('install.sh', (s) => s.replace(`v${oldV}`, `v${next}`).replace(`VERSION="${oldV}"`, `VERSION="${next}"`))
await patch('skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md', (s) => s.replace(`version: "${oldV}"`, `version: "${next}"`))
await patch('docs/INSTALL.md', (s) => s
    .replaceAll(`v${oldV}`, `v${next}`)
    .replaceAll(`--version ${oldV}`, `--version ${next}`))

// Deliberately does NOT print a release recipe any more. It used to, and the recipe it printed was
// broken — `git tag` (lightweight) followed by `git push --follow-tags`, a pair that cannot trigger a
// release because that flag pushes only annotated tags. RELEASE.md had the correct `-a` the whole
// time; the version people actually followed was the one this script printed right after they ran it.
// The flow is now executed by scripts/release.sh, so there is nothing here left to disagree with it.
console.log(`\nNow edit CHANGELOG.md (add the ## [${next}] section), then: pnpm run release:publish`)
