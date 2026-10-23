// User-level installation settings for Memoria (docs/issues/issue-28).
//
// Keeps persistent onboarding choices (default global data root, selected host agents, local vector
// recall enablement) separate from `<dataRoot>/configs/config.json`: the CLI needs this file BEFORE
// it knows where `<dataRoot>` is.
//
// Security & isolation rules:
//   - Never persist authentication tokens (e.g. LIBSQL_AUTH_TOKEN) here.
//   - Only read saved global default when no explicit flag, MEMORIA_HOME, or local project memory
//     exists, AND when the saved defaultDataRoot actually exists on disk (prevents a developer's
//     real ~/.config/memoria/install.json from hijacking isolated tests that swap HOME or use fresh
//     temp directories).
//   - Write atomically via a sibling `.tmp-<pid>-<now>` file + rename.

import { readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import type { MemoriaPaths } from './types.js'

export const INSTALL_HOST_AGENTS = ['claude-code', 'codex'] as const
export type InstallHostAgent = (typeof INSTALL_HOST_AGENTS)[number]

const installVectorSchema = z.object({
    enabled: z.boolean(),
    provider: z.enum(['local', 'stub']).default('local'),
    /** Roots where local vector recall was enabled during setup; allows project-scoped vector enablement
     *  as well as global enablement while keeping each root's vector store isolated under its own `.memory/vectors.db`. */
    roots: z.array(z.string()).optional()
})

const installSettingsSchema = z.object({
    version: z.literal(1).default(1),
    defaultDataRoot: z.string().min(1).optional(),
    hosts: z.array(z.enum(INSTALL_HOST_AGENTS)).optional(),
    vector: installVectorSchema.optional(),
    updatedAt: z.string()
})

export type InstallVectorSettings = z.infer<typeof installVectorSchema>
export type InstallSettings = z.infer<typeof installSettingsSchema>

export type InstallSettingsContext = {
    platform?: NodeJS.Platform
    homedir?: string
    env?: NodeJS.ProcessEnv
}

function resolveHomeDir(ctx: InstallSettingsContext): string {
    if (ctx.homedir && ctx.homedir.trim()) return ctx.homedir.trim()
    const envHome = (ctx.env ?? process.env).HOME?.trim()
    if (envHome) return envHome
    return os.homedir()
}

/**
 * Resolve the platform-specific user install settings file (`install.json`).
 * - Override: `MEMORIA_USER_CONFIG_PATH` (used by isolated tests or custom deployments)
 * - Linux / other POSIX: `${XDG_CONFIG_HOME}/memoria/install.json` (when XDG_CONFIG_HOME is absolute)
 *   else `~/.config/memoria/install.json`
 * - macOS (`darwin`): `${XDG_CONFIG_HOME}/memoria/install.json` when explicitly set and absolute,
 *   else `~/Library/Application Support/memoria/install.json`
 * - Windows (`win32`): `${APPDATA}\memoria\install.json` else `~\AppData\Roaming\memoria\install.json`
 */
export function resolveInstallSettingsPath(ctx: InstallSettingsContext = {}): string {
    const env = ctx.env ?? process.env
    const explicit = env.MEMORIA_USER_CONFIG_PATH?.trim()
    if (explicit) return path.resolve(explicit)

    const platform = ctx.platform ?? process.platform
    const home = resolveHomeDir(ctx)
    const xdg = env.XDG_CONFIG_HOME?.trim()
    const hasAbsoluteXdg = Boolean(xdg && (path.isAbsolute(xdg) || xdg.startsWith('/')))

    if (platform === 'win32') {
        const appData = env.APPDATA?.trim() || path.join(home, 'AppData', 'Roaming')
        return path.join(appData, 'memoria', 'install.json')
    }

    if (platform === 'darwin') {
        if (hasAbsoluteXdg && xdg) return path.join(xdg, 'memoria', 'install.json')
        return path.join(home, 'Library', 'Application Support', 'memoria', 'install.json')
    }

    const base = hasAbsoluteXdg && xdg ? xdg : path.join(home, '.config')
    return path.join(base, 'memoria', 'install.json')
}

/**Resolve the default global data root when a user chooses global scope in `memoria setup`. */
export function resolveDefaultGlobalDataRoot(ctx: InstallSettingsContext = {}): string {
    const env = ctx.env ?? process.env
    const platform = ctx.platform ?? process.platform
    const home = resolveHomeDir(ctx)
    const xdgData = env.XDG_DATA_HOME?.trim()
    // Only honor XDG_DATA_HOME when the caller did not explicitly isolate HOME (or when XDG_DATA_HOME sits inside that HOME)
    const homeOverridden = Boolean(ctx.homedir || (env.HOME && env.HOME !== os.homedir()))
    const hasAbsoluteXdgData = Boolean(
        xdgData &&
        (path.isAbsolute(xdgData) || xdgData.startsWith('/')) &&
        (!homeOverridden || xdgData.startsWith(home))
    )

    if (platform === 'win32') {
        const localAppData = (!homeOverridden && (env.LOCALAPPDATA?.trim() || env.APPDATA?.trim())) || path.join(home, 'AppData', 'Local')
        return path.join(localAppData, 'memoria')
    }
    if (platform === 'darwin') {
        if (hasAbsoluteXdgData && xdgData) return path.join(xdgData, 'memoria')
        return path.join(home, '.memoria')
    }
    if (hasAbsoluteXdgData && xdgData) return path.join(xdgData, 'memoria')
    return path.join(home, '.memoria')
}

export function loadInstallSettingsSync(ctx: InstallSettingsContext = {}): InstallSettings | null {
    const file = resolveInstallSettingsPath(ctx)
    let raw: string
    try {
        raw = readFileSync(file, 'utf8')
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        return null
    }

    try {
        const parsed = JSON.parse(raw) as unknown
        const result = installSettingsSchema.safeParse(parsed)
        if (!result.success) return null
        const data = result.data
        return {
            ...data,
            ...(data.defaultDataRoot ? { defaultDataRoot: path.resolve(data.defaultDataRoot) } : {}),
            ...(data.vector?.roots ? {
                vector: {
                    ...data.vector,
                    roots: data.vector.roots.map((r) => path.resolve(r))
                }
            } : {})
        }
    } catch {
        return null
    }
}

export async function saveInstallSettings(
    settings: InstallSettings,
    ctx: InstallSettingsContext = {}
): Promise<string> {
    const file = resolveInstallSettingsPath(ctx)
    const normalized: InstallSettings = installSettingsSchema.parse({
        version: 1,
        ...(settings.defaultDataRoot ? { defaultDataRoot: path.resolve(settings.defaultDataRoot) } : {}),
        ...(settings.hosts ? { hosts: Array.from(new Set(settings.hosts)) } : {}),
        ...(settings.vector ? {
            vector: {
                enabled: settings.vector.enabled,
                provider: settings.vector.provider,
                ...(settings.vector.roots ? { roots: Array.from(new Set(settings.vector.roots.map((r) => path.resolve(r)))) } : {})
            }
        } : {}),
        updatedAt: settings.updatedAt || new Date().toISOString()
    })

    await fs.mkdir(path.dirname(file), { recursive: true })
    const tmpFile = `${file}.tmp-${process.pid}-${Date.now()}`
    await fs.writeFile(tmpFile, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
    await fs.rename(tmpFile, file)
    return file
}

export function resolveLocalVectorDbPath(dataRoot: string): string {
    return path.join(path.resolve(dataRoot), '.memory', 'vectors.db')
}

// Track values injected into `process.env` by `applyEffectiveVectorEnv()` so a subsequent call in the
// same process (for example `memoria setup --memoria-home B` after CLI startup applied root A's default)
// does not mistake its own auto-injected `LIBSQL_URL` for a caller's explicit environment override.
let appliedLibsqlUrl: string | undefined
let appliedEmbedProvider: string | undefined

export function getExplicitVectorEnv(env: NodeJS.ProcessEnv = process.env): {
    libsqlUrl: string | undefined
    embedProvider: string | undefined
} {
    const rawUrl = env.LIBSQL_URL?.trim() || undefined
    const rawProvider = env.MEMORIA_EMBED_PROVIDER?.trim() || undefined
    const isProcessEnv = env === process.env
    return {
        libsqlUrl: isProcessEnv && rawUrl && rawUrl === appliedLibsqlUrl ? undefined : rawUrl,
        embedProvider: isProcessEnv && rawProvider && rawProvider === appliedEmbedProvider ? undefined : rawProvider
    }
}

/**
 * Determine effective `LIBSQL_URL` and `MEMORIA_EMBED_PROVIDER` for a given `effectiveDataRoot`.
 * Explicit environment variables always win (SCN-012). Otherwise, if local vector recall was enabled
 * in user install settings (either globally or for this specific root), derive a root-local
 * `file:<effectiveDataRoot>/.memory/vectors.db` so switching data roots never mixes vector stores.
 */
export function resolveEffectiveVectorEnv(
    effectiveDataRoot: string,
    ctx: InstallSettingsContext = {}
): { libsqlUrl: string | undefined; embedProvider: string | undefined; fromSettings: boolean } {
    const env = ctx.env ?? process.env
    const { libsqlUrl: explicitUrl, embedProvider: explicitProvider } = getExplicitVectorEnv(env)
    if (explicitUrl && explicitProvider) {
        return { libsqlUrl: explicitUrl, embedProvider: explicitProvider, fromSettings: false }
    }

    const settings = loadInstallSettingsSync(ctx)
    const rootResolved = path.resolve(effectiveDataRoot)
    const hasExplicitRootsList = Array.isArray(settings?.vector?.roots)
    const vectorEnabledForRoot = Boolean(
        settings?.vector?.enabled &&
        (hasExplicitRootsList
            ? settings!.vector!.roots!.includes(rootResolved)
            : Boolean(settings?.defaultDataRoot && path.resolve(settings.defaultDataRoot) === rootResolved))
    )

    if (!vectorEnabledForRoot) {
        return { libsqlUrl: explicitUrl, embedProvider: explicitProvider, fromSettings: false }
    }

    return {
        libsqlUrl: explicitUrl ?? `file:${resolveLocalVectorDbPath(rootResolved)}`,
        embedProvider: explicitProvider ?? settings?.vector?.provider ?? 'local',
        fromSettings: !explicitUrl || !explicitProvider
    }
}

/**
 * Apply saved vector settings to `process.env` when not already explicitly set in the environment.
 * Re-evaluating for a different `effectiveDataRoot` replaces or clears any previously auto-injected value.
 */
export function applyEffectiveVectorEnv(
    effectiveDataRoot: string,
    ctx: InstallSettingsContext = {}
): { libsqlUrl: string | undefined; embedProvider: string | undefined; fromSettings: boolean } {
    const env = ctx.env ?? process.env
    const isProcessEnv = env === process.env
    const { libsqlUrl: explicitUrl, embedProvider: explicitProvider } = getExplicitVectorEnv(env)
    const resolved = resolveEffectiveVectorEnv(effectiveDataRoot, ctx)

    if (!explicitUrl) {
        if (resolved.libsqlUrl) {
            env.LIBSQL_URL = resolved.libsqlUrl
            if (isProcessEnv) appliedLibsqlUrl = resolved.libsqlUrl
        } else {
            delete env.LIBSQL_URL
            if (isProcessEnv) appliedLibsqlUrl = undefined
        }
    }

    if (!explicitProvider) {
        if (resolved.embedProvider) {
            env.MEMORIA_EMBED_PROVIDER = resolved.embedProvider
            if (isProcessEnv) appliedEmbedProvider = resolved.embedProvider
        } else {
            delete env.MEMORIA_EMBED_PROVIDER
            if (isProcessEnv) appliedEmbedProvider = undefined
        }
    }

    return resolved
}

/**
 * Guard before running vector ingest: `build-mcp-bridge-payload.mjs` reads `<memoriaHome>/.memory/sessions.db`.
 * If `MEMORIA_DB_PATH` points anywhere else, ingest would silently embed the wrong corpus (SCN-012 / issue-27).
 */
export function assertIngestDbPathMatchesRoot(paths: Pick<MemoriaPaths, 'memoriaHome' | 'dbPath'>): void {
    const expectedDbPath = path.resolve(paths.memoriaHome, '.memory', 'sessions.db')
    const actualDbPath = path.resolve(paths.dbPath)
    if (actualDbPath !== expectedDbPath) {
        throw new Error(
            `MEMORIA_DB_PATH points at ${paths.dbPath}, which does not match the data root's database ` +
            `(${expectedDbPath}); refusing to run vector ingest against a mismatched corpus.`
        )
    }
}
