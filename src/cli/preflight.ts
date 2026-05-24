import fs from 'node:fs/promises'
import path from 'node:path'
import { existsSync } from '../core/index.js'
import type { RuntimeLayout } from './runtime.js'

export type PreflightCheck = { id: string; status: 'pass' | 'fail'; detail: string; fix?: string }

export async function runPreflight(
    memoriaHome: string,
    layout: RuntimeLayout
): Promise<{ ok: boolean; checks: PreflightCheck[] }> {
    const checks: PreflightCheck[] = []

    const nodeVer = process.versions.node
    const [major] = nodeVer.split('.').map(Number)
    checks.push({
        id: 'node_version',
        status: major >= 18 ? 'pass' : 'fail',
        detail: `v${nodeVer}`,
        fix: major < 18 ? 'Install Node.js >= 18 via nvm/fnm: https://github.com/nvm-sh/nvm' : undefined
    })

    if (layout.canSelfInstallDeps) {
        try {
            const { execSync } = await import('node:child_process')
            const pnpmVer = execSync('pnpm --version', { stdio: 'pipe' }).toString().trim()
            checks.push({ id: 'pnpm', status: 'pass', detail: pnpmVer })
        } catch {
            checks.push({
                id: 'pnpm',
                status: 'fail',
                detail: 'not found',
                fix: 'Install pnpm: npm install -g pnpm'
            })
        }
    } else {
        checks.push({ id: 'pnpm', status: 'pass', detail: 'not required in installed mode' })
    }

    const probePath = existsSync(memoriaHome) ? memoriaHome : path.dirname(memoriaHome)

    try {
        const { statfs } = await import('node:fs/promises')
        const st = await statfs(probePath)
        const availMB = Math.floor((st.bavail * st.bsize) / (1024 * 1024))
        checks.push({
            id: 'disk_space',
            status: availMB >= 100 ? 'pass' : 'fail',
            detail: `${availMB}MB available`,
            fix: availMB < 100 ? 'Free up disk space.' : undefined
        })
    } catch {
        checks.push({ id: 'disk_space', status: 'pass', detail: 'unknown (skipping check)' })
    }

    try {
        const testPath = path.join(probePath, `.memoria_preflight_${Date.now()}`)
        await fs.writeFile(testPath, '')
        await fs.unlink(testPath)
        checks.push({ id: 'write_permission', status: 'pass', detail: memoriaHome })
    } catch {
        checks.push({
            id: 'write_permission',
            status: 'fail',
            detail: `Cannot write to ${memoriaHome}`,
            fix: `Fix permissions: chmod u+w "${memoriaHome}"`
        })
    }

    return { ok: checks.every((c) => c.status === 'pass'), checks }
}
