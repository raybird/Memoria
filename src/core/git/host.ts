// Stable per-machine identity for repository_instances (spec §9.2, docs/issues/issue-1).
//
// A generated-once UUID stored under the memory dir. Hostnames change across renames and OS
// reinstalls, so they are unusable as host_id — the file is the identity.

import path from 'node:path'
import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

export const HOST_ID_FILE_NAME = 'host-id'

/** This machine's host id if one exists yet; null when nothing has created it. */
export async function readHostId(memoryDir: string): Promise<string | null> {
    try {
        return (await fs.readFile(path.join(memoryDir, HOST_ID_FILE_NAME), 'utf8')).trim() || null
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        return null
    }
}

/** Return this machine's stable host id, creating `<memoryDir>/host-id` on first use. */
export async function getHostId(memoryDir: string): Promise<string> {
    const existing = await readHostId(memoryDir)
    if (existing) return existing
    const file = path.join(memoryDir, HOST_ID_FILE_NAME)
    const hostId = randomUUID()
    await fs.mkdir(memoryDir, { recursive: true })
    await fs.writeFile(file, `${hostId}\n`, 'utf8')
    return hostId
}
