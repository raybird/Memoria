#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'

const bannedTokens = ['./cli', 'bash skills/', 'node skills/', 'git clone']

function parseArgs(argv) {
  const args = {
    root: process.cwd()
  }

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i]
    const next = argv[i + 1]
    if (token === '--root' && next) {
      args.root = path.resolve(next)
      i += 1
      continue
    }
    throw new Error(`Unknown or incomplete argument: ${token}`)
  }

  return args
}

async function readText(filePath) {
  return fs.readFile(filePath, 'utf8')
}

function readFrontmatterValue(markdown, key) {
  const match = markdown.match(new RegExp(`^${key}:\\s*"?([^"\\n]+)"?$`, 'm'))
  return match?.[1]?.trim()
}

async function ensureExists(filePath) {
  await fs.access(filePath)
}

async function main() {
  const args = parseArgs(process.argv)
  const pkgPath = path.join(args.root, 'package.json')
  const skillRoot = path.join(args.root, 'skills', 'memoria-memory-sync')
  const deployedRoot = path.join(skillRoot, 'deployed')

  const pkg = JSON.parse(await readText(pkgPath))
  const expectedVersion = String(pkg.version)

  const requiredFiles = [
    path.join(deployedRoot, 'DEPLOYED_SKILL.md'),
    path.join(deployedRoot, 'DEPLOYED_REFERENCE.md'),
    path.join(skillRoot, 'scripts', 'run-sync.sh'),
    path.join(skillRoot, 'scripts', 'run-sync-with-enhancement.sh'),
    path.join(skillRoot, 'resources', 'mcp', 'INGEST_PLAYBOOK.md'),
    path.join(skillRoot, 'resources', 'mcp', 'gemini-cli.mcp.json'),
    path.join(skillRoot, 'resources', 'mcp', 'opencode.mcp.json')
  ]

  await Promise.all(requiredFiles.map(ensureExists))

  const deployedSkill = await readText(path.join(deployedRoot, 'DEPLOYED_SKILL.md'))
  const deployedReference = await readText(path.join(deployedRoot, 'DEPLOYED_REFERENCE.md'))
  const deployedSkillVersion = readFrontmatterValue(deployedSkill, 'version')
  const deploymentMode = readFrontmatterValue(deployedSkill, 'deployment_mode')

  if (deployedSkillVersion !== expectedVersion) {
    throw new Error(`Deployed skill version mismatch: expected ${expectedVersion}, found ${deployedSkillVersion ?? '(missing)'}`)
  }

  if (deploymentMode !== 'installed') {
    throw new Error(`Deployed skill deployment_mode must be 'installed'; found ${deploymentMode ?? '(missing)'}`)
  }

  for (const [label, text] of [['DEPLOYED_SKILL.md', deployedSkill], ['DEPLOYED_REFERENCE.md', deployedReference]]) {
    for (const token of bannedTokens) {
      if (text.includes(token)) {
        throw new Error(`${label} contains repo-only token: ${token}`)
      }
    }
  }

  console.log(`deployed_skill_check=ok version=${expectedVersion}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
