// Path resolution for Memoria
// Extracted from cli.ts – resolves MEMORIA_HOME and all derived paths

import path from 'node:path'
import { existsSync as fsExistsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { MemoriaPaths } from './types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export function existsSync(targetPath: string): boolean {
    return fsExistsSync(targetPath)
}

export function getMemoriaHome(): string {
    const envHome = process.env.MEMORIA_HOME
    if (envHome) return path.resolve(envHome)

    const cwd = process.cwd()
    if (existsSync(path.join(cwd, '.memory')) || existsSync(path.join(cwd, 'knowledge'))) return cwd

    return path.resolve(__dirname, '..', '..')
}

function resolvePathFromEnv(raw: string | undefined): string | undefined {
    if (!raw || !raw.trim()) return undefined
    return path.resolve(raw)
}

export function resolveMemoriaPaths(memoriaHomeOverride?: string): MemoriaPaths {
    const memoriaHome = memoriaHomeOverride ?? getMemoriaHome()

    const dbPathFromEnv = resolvePathFromEnv(process.env.MEMORIA_DB_PATH)
    const dbPath = dbPathFromEnv ?? path.join(memoriaHome, '.memory', 'sessions.db')
    const memoryDir = path.dirname(dbPath)

    const sessionsPath =
        resolvePathFromEnv(process.env.MEMORIA_SESSIONS_PATH) ?? path.join(memoryDir, 'sessions')

    const configPath =
        resolvePathFromEnv(process.env.MEMORIA_CONFIG_PATH) ?? path.join(memoriaHome, 'configs')

    return {
        memoriaHome,
        memoryDir,
        knowledgeDir: path.join(memoriaHome, 'knowledge'),
        dbPath,
        sessionsPath,
        configPath
    }
}
