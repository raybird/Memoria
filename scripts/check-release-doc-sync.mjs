#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.resolve(__dirname, '..')

function readText(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8')
}

function checkContains(text, needle) {
  return text.includes(needle)
}

function main() {
  const failures = []

  const pkg = JSON.parse(readText('package.json'))
  const version = String(pkg.version ?? '').trim()

  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    failures.push(`package.json version is invalid: '${version}'`)
  }

  const cliTs = readText('src/cli.ts')
  const cliVersionMatch = /\.version\('([^']+)'\)/.exec(cliTs)
  const cliVersion = cliVersionMatch?.[1] ?? ''
  if (cliVersion !== version) {
    failures.push(`src/cli.ts version '${cliVersion}' does not match package.json '${version}'`)
  }

  const installSh = readText('install.sh')
  const installVersionMatch = /快速安裝腳本 v(\d+\.\d+\.\d+)/.exec(installSh)
  const installVersion = installVersionMatch?.[1] ?? ''
  if (installVersion !== version) {
    failures.push(`install.sh banner version '${installVersion}' does not match package.json '${version}'`)
  }

  const changelog = readText('CHANGELOG.md')
  if (!checkContains(changelog, `## [${version}]`)) {
    failures.push(`CHANGELOG.md missing section for version ${version}`)
  }

  const readme = readText('README.md')
  if (!checkContains(readme, '/v1/telemetry/recall')) {
    failures.push('README.md missing /v1/telemetry/recall endpoint docs')
  }
  if (!checkContains(readme, 'index build')) {
    failures.push('README.md missing index build command docs')
  }

  const spec = readText('SPEC.md')
  if (!checkContains(spec, 'memory_nodes')) {
    failures.push('SPEC.md missing memory_nodes table in implemented scope')
  }
  if (!checkContains(spec, 'mode: keyword | tree | hybrid')) {
    failures.push('SPEC.md missing recall mode docs (keyword|tree|hybrid)')
  }

  const ops = readText('docs/OPERATIONS.md')
  if (!checkContains(ops, '/v1/telemetry/recall')) {
    failures.push('docs/OPERATIONS.md missing telemetry endpoint usage')
  }

  const mcp = readText('docs/MCP_INTEGRATION.md')
  if (!checkContains(mcp, 'MEMORIA_MCP_PAYLOAD_MODE')) {
    failures.push('docs/MCP_INTEGRATION.md missing MEMORIA_MCP_PAYLOAD_MODE docs')
  }
  if (!checkContains(mcp, 'memory_sync_state')) {
    failures.push('docs/MCP_INTEGRATION.md missing memory_sync_state docs')
  }

  if (failures.length > 0) {
    console.error('Release doc sync check failed:')
    for (const item of failures) {
      console.error(`- ${item}`)
    }
    process.exit(1)
  }

  console.log(`Release doc sync check passed for v${version}`)
}

main()
