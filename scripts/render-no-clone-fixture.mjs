#!/usr/bin/env node

import fs from 'node:fs/promises'

const outputPath = process.argv[2]

if (!outputPath) {
  console.error('Usage: node scripts/render-no-clone-fixture.mjs <output-path>')
  process.exit(1)
}

const fixture = {
  id: 'session_no_clone_install_001',
  timestamp: '2026-04-01T12:00:00Z',
  project: 'Memoria',
  summary: 'Validated no-clone installation flow for release artifacts.',
  events: [
    {
      timestamp: '2026-04-01T12:00:01Z',
      type: 'DecisionMade',
      content: {
        decision: 'Ship no-clone installer via release artifact',
        rationale: 'Allow bootstrap without cloning the repository.'
      },
      metadata: {
        channel: 'no-clone-test'
      }
    }
  ]
}

await fs.writeFile(outputPath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
