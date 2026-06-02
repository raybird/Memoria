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

export type MemoriaHomeSource = 'env' | 'detected' | 'fallback'

export type MemoriaHomeResolution = {
    home: string
    source: MemoriaHomeSource
}

// Resolve MEMORIA_HOME and report HOW it was resolved so callers (doctor/preflight)
// can warn when we silently fell back to the runtime root instead of a real data root.
export function resolveMemoriaHomeInfo(): MemoriaHomeResolution {
    const envHome = process.env.MEMORIA_HOME
    if (envHome) return { home: path.resolve(envHome), source: 'env' }

    const cwd = process.cwd()
    if (existsSync(path.join(cwd, '.memory')) || existsSync(path.join(cwd, 'knowledge'))) {
        return { home: cwd, source: 'detected' }
    }

    const nestedMemoriaHome = path.join(cwd, 'memoria')
    if (existsSync(path.join(nestedMemoriaHome, '.memory')) || existsSync(path.join(nestedMemoriaHome, 'knowledge'))) {
        return { home: nestedMemoriaHome, source: 'detected' }
    }

    return { home: path.resolve(__dirname, '..', '..'), source: 'fallback' }
}

export function getMemoriaHome(): string {
    return resolveMemoriaHomeInfo().home
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
