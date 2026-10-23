// Path resolution for Memoria
// Extracted from cli.ts – resolves MEMORIA_HOME and all derived paths

import path from 'node:path'
import { existsSync as fsExistsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { MemoriaPaths } from './types.js'
import { loadInstallSettingsSync } from './install-settings.js'
import type { InstallSettingsContext } from './install-settings.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export function existsSync(targetPath: string): boolean {
    return fsExistsSync(targetPath)
}

export type MemoriaHomeSource = 'env' | 'detected' | 'global-config' | 'fallback'

export type MemoriaHomeResolution = {
    home: string
    source: MemoriaHomeSource
}

export type PathResolveContext = InstallSettingsContext & {
    cwd?: string
}

// Resolve MEMORIA_HOME and report HOW it was resolved so callers (doctor/preflight)
// can warn when we silently fell back to the runtime root instead of a real data root.
// Precedence (issue-28):
//   1. MEMORIA_HOME environment variable ('env')
//   2. Local project memory in cwd or cwd/memoria ('detected')
//   3. Saved global default in user install settings ('global-config')
//   4. Runtime root fallback ('fallback')
export function resolveMemoriaHomeInfo(ctx: PathResolveContext = {}): MemoriaHomeResolution {
    const env = ctx.env ?? process.env
    const envHome = env.MEMORIA_HOME
    if (envHome && envHome.trim()) return { home: path.resolve(envHome), source: 'env' }

    const cwd = ctx.cwd ?? process.cwd()
    if (existsSync(path.join(cwd, '.memory')) || existsSync(path.join(cwd, 'knowledge'))) {
        return { home: path.resolve(cwd), source: 'detected' }
    }

    const nestedMemoriaHome = path.join(cwd, 'memoria')
    if (existsSync(path.join(nestedMemoriaHome, '.memory')) || existsSync(path.join(nestedMemoriaHome, 'knowledge'))) {
        return { home: path.resolve(nestedMemoriaHome), source: 'detected' }
    }

    const settings = loadInstallSettingsSync(ctx)
    if (settings?.defaultDataRoot) {
        return { home: path.resolve(settings.defaultDataRoot), source: 'global-config' }
    }

    return { home: path.resolve(__dirname, '..', '..'), source: 'fallback' }
}

export function getMemoriaHome(ctx: PathResolveContext = {}): string {
    return resolveMemoriaHomeInfo(ctx).home
}

function resolvePathFromEnv(raw: string | undefined): string | undefined {
    if (!raw || !raw.trim()) return undefined
    return path.resolve(raw)
}

export function resolveMemoriaPaths(memoriaHomeOverride?: string, ctx: PathResolveContext = {}): MemoriaPaths {
    const env = ctx.env ?? process.env
    const memoriaHome = memoriaHomeOverride ? path.resolve(memoriaHomeOverride) : getMemoriaHome(ctx)

    const dbPathFromEnv = resolvePathFromEnv(env.MEMORIA_DB_PATH)
    const dbPath = dbPathFromEnv ?? path.join(memoriaHome, '.memory', 'sessions.db')
    const memoryDir = path.dirname(dbPath)

    const sessionsPath =
        resolvePathFromEnv(env.MEMORIA_SESSIONS_PATH) ?? path.join(memoryDir, 'sessions')

    const configPath =
        resolvePathFromEnv(env.MEMORIA_CONFIG_PATH) ?? path.join(memoriaHome, 'configs')

    return {
        memoriaHome,
        memoryDir,
        knowledgeDir: path.join(memoriaHome, 'knowledge'),
        dbPath,
        sessionsPath,
        configPath
    }
}
