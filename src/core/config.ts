// Memoria config file loader (Git-Aware Memory spec §27, docs/issues/issue-1).
//
// First config-file surface in the repo — everything predating it stays env-var driven. Only the
// `git` block is parsed for now; unknown top-level keys are ignored so future blocks can land
// without breaking older binaries. A missing config.json yields pure defaults: the file is
// entirely optional.

import path from 'node:path'
import fs from 'node:fs/promises'
import { z } from 'zod'
import type { MemoriaPaths } from './types.js'

export const CONFIG_FILE_NAME = 'config.json'

const gitSummarizationSchema = z
    .object({
        enabled: z.boolean().default(true),
        minimumCommits: z.number().int().min(1).default(2),
        minimumChangedLines: z.number().int().min(0).default(20),
        branchIdleHours: z.number().min(0).default(24),
        promoteImportanceThreshold: z.number().min(0).max(1).default(0.7),
        includeDiff: z.boolean().default(true),
        maxDiffBytes: z.number().int().min(0).default(200_000)
    })
    .prefault({})

const gitFiltersSchema = z
    .object({
        excludePaths: z
            .array(z.string())
            .default(['node_modules/**', 'dist/**', 'build/**', 'coverage/**', '*.lock']),
        sensitivePaths: z
            .array(z.string())
            .default(['.env', '.env.*', '*.pem', '*.key', 'credentials.*', 'service-account*.json', 'secrets/**', 'private/**'])
    })
    .prefault({})

const gitConfigSchema = z
    .object({
        enabled: z.boolean().default(true),
        autoSyncOnSessionStart: z.boolean().default(true),
        autoSyncOnSessionEnd: z.boolean().default(true),
        summarization: gitSummarizationSchema,
        filters: gitFiltersSchema
    })
    .prefault({})

const memoriaConfigSchema = z.object({
    git: gitConfigSchema
})

export type MemoriaGitConfig = z.infer<typeof gitConfigSchema>
export type MemoriaConfig = z.infer<typeof memoriaConfigSchema>

export function defaultMemoriaConfig(): MemoriaConfig {
    return memoriaConfigSchema.parse({})
}

/** Load `<configPath>/config.json`. Missing file → defaults; malformed file → descriptive throw. */
export async function loadMemoriaConfig(paths: Pick<MemoriaPaths, 'configPath'>): Promise<MemoriaConfig> {
    const file = path.join(paths.configPath, CONFIG_FILE_NAME)

    let raw: string
    try {
        raw = await fs.readFile(file, 'utf8')
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultMemoriaConfig()
        throw error
    }

    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch (error) {
        throw new Error(`Invalid JSON in ${file}: ${(error as Error).message}`)
    }

    const result = memoriaConfigSchema.safeParse(parsed)
    if (!result.success) {
        const detail = result.error.issues
            .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
            .join('; ')
        throw new Error(`Invalid config in ${file}: ${detail}`)
    }
    return result.data
}
