#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { argv, exit } from 'node:process'

const usage = `Usage: node scripts/bump-version.mjs <patch|minor|major|x.y.z>

Updates version in:
  - package.json
  - src/cli.ts (.version('...'))
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
  if (out === src) { console.warn(`  ⚠ ${file}: no change`); return }
  await writeFile(file, out)
  console.log(`  ✓ ${file}`)
}

pkg.version = next
await writeFile('package.json', JSON.stringify(pkg, null, 2) + '\n')
console.log(`  ✓ package.json`)

await patch('src/cli.ts', (s) => s.replace(`.version('${oldV}')`, `.version('${next}')`))
await patch('install.sh', (s) => s.replace(`v${oldV}`, `v${next}`).replace(`VERSION="${oldV}"`, `VERSION="${next}"`))
await patch('skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md', (s) => s.replace(`version: "${oldV}"`, `version: "${next}"`))
await patch('docs/INSTALL.md', (s) => s.replaceAll(`v${oldV}`, `v${next}`))

console.log(`\nNext steps:`)
console.log(`  1. Edit CHANGELOG.md: add ## [${next}] - $(date +%Y-%m-%d) section`)
console.log(`  2. pnpm run build && pnpm run release:package`)
console.log(`  3. git commit -am "Release v${next}" && git tag v${next}`)
console.log(`  4. git push --follow-tags  (CI will create GitHub release + npm publish)`)
