#!/usr/bin/env node

import fs from 'node:fs/promises'

const outputPath = process.argv[2]

if (!outputPath) {
  console.error('Usage: node scripts/render-wiki-source-fixture.mjs <output-path>')
  process.exit(1)
}

const content = `# LLM Wiki Fixture

Memoria should ingest this markdown source and compile a source-summary page.

Key idea: persistent wiki pages should accumulate cross-session knowledge.
`

await fs.writeFile(outputPath, content, 'utf8')
