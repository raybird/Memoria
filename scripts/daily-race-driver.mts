// Race driver for scripts/test-cli-memory.sh (issue-33 SCN-005, review-9d76366 M1).
// Run via `pnpm exec tsx` from the repo root: argv = <memoriaHome> <rounds>.
//
// Calls syncDailyNote itself from one process per session, all released at the same instant, on a
// Daily file that does not exist yet. A CLI-level race (16 `remember` processes) hits the
// "first writer creates the file" window only rarely because process start-up spreads the writers
// out; this driver lines them up so that window is exercised every round.

import { fork } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { syncDailyNote } from '../src/core/db/sync.js'

const [home, roundsArg, role, sessionId] = process.argv.slice(2)
const dbPath = path.join(home, '.memory', 'sessions.db')
const dailyDir = path.join(home, 'knowledge', 'Daily')

if (role === 'child') {
    // An id with no session row returns before touching the file, but opens the pooled readonly
    // connection, so after "go" each writer only runs one query before its fs calls.
    await syncDailyNote(home, dbPath, '__warm_up__')
    process.send?.('ready')
    process.on('message', async (startAt: number) => {
        while (Date.now() < startAt) { /* line every writer up on the same instant */ }
        await syncDailyNote(home, dbPath, sessionId)
        process.disconnect()
    })
} else {
    const db = new Database(dbPath, { readonly: true })
    const ids = (db.prepare('SELECT id FROM sessions ORDER BY id').all() as Array<{ id: string }>).map((r) => r.id)
    db.close()
    if (ids.length < 2) {
        console.error(`  ✗ need at least 2 sessions in ${dbPath}, found ${ids.length}`)
        process.exit(2)
    }

    const self = fileURLToPath(import.meta.url)
    const broken: string[] = []
    const rounds = Number(roundsArg)
    for (let round = 1; round <= rounds; round++) {
        await fs.rm(dailyDir, { recursive: true, force: true })
        await fs.mkdir(dailyDir, { recursive: true })
        const children = ids.map((id) => fork(self, [home, roundsArg, 'child', id]))
        await Promise.all(children.map((child) => new Promise<void>((resolve) => child.once('message', () => resolve()))))
        const startAt = Date.now() + 50
        const exits = children.map((child) => new Promise<number | null>((resolve) => child.once('exit', resolve)))
        for (const child of children) child.send(startAt)
        const codes = await Promise.all(exits)
        if (codes.some((code) => code !== 0)) {
            console.error(`  ✗ round ${round}: a writer exited with ${codes.join(',')}`)
            process.exit(1)
        }

        const files = await fs.readdir(dailyDir)
        const text = (await Promise.all(files.map((f) => fs.readFile(path.join(dailyDir, f), 'utf8')))).join('')
        const entries = text.match(/^## /gm)?.length ?? 0
        const headers = text.match(/^# /gm)?.length ?? 0
        const missing = ids.filter((id) => !text.includes(`Session ID: \`${id}\``))
        const startsWithHeader = await Promise.all(files.map(async (f) =>
            (await fs.readFile(path.join(dailyDir, f), 'utf8')).startsWith('# ')))
        if (entries !== ids.length || headers !== files.length || missing.length > 0 || startsWithHeader.includes(false)) {
            broken.push(`round ${round}: ${entries} entries, ${headers} headers for ${ids.length} sessions` +
                (missing.length ? `, ${missing.length} session ids missing` : ''))
        }
    }

    if (broken.length > 0) {
        console.error(`  ✗ ${broken.length}/${rounds} rounds lost or corrupted Daily entries`)
        for (const line of broken.slice(0, 5)) console.error(`    ${line}`)
        process.exit(1)
    }
    console.log(`  ${rounds} 輪、每輪 ${ids.length} 個程式在同一時刻寫入尚未存在的 Daily，條目與檔頭都完整`)
}
