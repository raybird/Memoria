#!/usr/bin/env node
// Delivery parity between the two install routes.
//
// Memoria ships through two independent paths — the npm package (`package.json` "files") and the
// release tarball (`package-release-artifacts.sh`) — and until issue-10 nothing connected them. That
// is exactly how the semantic-recall helper came to be in one and not the other for three releases:
// v1.23.1 added it to "files", the packaging script was never touched, and the tarball's own
// required-entry list could not catch it because nobody had thought to list it there either. A
// must-contain list only defends the entries someone remembered to add.
//
// So this check derives instead of duplicating. The npm side comes from `npm pack --dry-run --json`
// — npm's own answer about what it would ship, not a re-implementation of its glob/.npmignore
// semantics, which would be one more replica free to drift. Every packed path must then either
// appear in the tarball at the same relative path, or be classified below as deliberately delivered
// some other way. An unclassified path is a hard failure: that is the case where someone added a
// file to one route and the other route silently did without it.
//
// Usage: node scripts/check-delivery-parity.mjs <tarball> <artifact-basename>

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

/** npm-shipped paths that the tarball intentionally does NOT carry at the same path, each with the
 *  reason. Adding an entry here is a decision that has to be written down; that is the point. */
const DELIVERED_ELSEWHERE = [
    { prefix: 'dist/cli.mjs', why: 'staged as lib/cli.mjs — the tarball uses a bin/lib layout' },
    { prefix: 'examples/', why: 'sample sessions are documentation for the repo, not runtime input' },
    { prefix: 'README.md', why: 'docs live on GitHub/npm; the tarball is a runtime payload' },
    { prefix: 'README.zh-TW.md', why: 'same as README.md' },
    { prefix: 'CHANGELOG.md', why: 'release notes are published with the GitHub Release' },
    { prefix: 'LICENSE', why: 'carried by the repo and the npm package' },
    { prefix: 'package.json', why: 'the tarball stages its own copy at the archive root' }
]

function npmPackedFiles() {
    const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 32 * 1024 * 1024
    })
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0 || !Array.isArray(parsed[0].files)) {
        throw new Error('unexpected `npm pack --dry-run --json` output shape')
    }
    return parsed[0].files.map((entry) => entry.path)
}

function tarEntries(tarball) {
    return new Set(
        execFileSync('tar', ['-tf', tarball], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
            .split('\n')
            .map((line) => line.replace(/\/$/, ''))
            .filter(Boolean)
    )
}

function main() {
    const [tarball, basename] = process.argv.slice(2)
    if (!tarball || !basename) {
        console.error('usage: check-delivery-parity.mjs <tarball> <artifact-basename>')
        process.exit(1)
    }

    const entries = tarEntries(tarball)
    const missing = []

    for (const packed of npmPackedFiles()) {
        if (entries.has(`${basename}/${packed}`)) continue
        if (DELIVERED_ELSEWHERE.some((rule) => packed === rule.prefix || packed.startsWith(rule.prefix))) continue
        missing.push(packed)
    }

    if (missing.length > 0) {
        console.error('Delivery parity check failed.')
        console.error('These paths ship to npm but are absent from the release tarball, and are not')
        console.error('classified as delivered elsewhere:')
        for (const file of missing) console.error(`  - ${file}`)
        console.error('')
        console.error('Either stage them in scripts/package-release-artifacts.sh, or add them to')
        console.error('DELIVERED_ELSEWHERE in this file WITH the reason. Silence is not an option:')
        console.error('an install route that quietly lacks a file fails at the user, not here.')
        process.exit(1)
    }

    console.log('Delivery parity check passed (npm files ⊆ tarball, modulo declared exceptions)')
}

main()
