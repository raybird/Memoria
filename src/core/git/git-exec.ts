// Read-only git execution layer for Git-Aware Memory (docs/issues/issue-1).
//
// Non-invasive contract (spec §5): Memoria only OBSERVES managed repositories. This module is the
// single choke point for running git — the subcommand allowlist is enforced at runtime so no
// caller can mutate a repository, its config, or its refs. GIT_OPTIONAL_LOCKS=0 keeps even
// `git status` from refreshing .git/index on disk.

import { spawn } from 'node:child_process'

export type GitErrorCode =
    | 'not_a_git_repository'
    | 'git_command_failed'
    | 'git_command_not_allowed'
    | 'git_timeout'

export class GitExecError extends Error {
    readonly code: GitErrorCode
    readonly exitCode: number | null
    readonly stderr: string

    constructor(code: GitErrorCode, message: string, exitCode: number | null = null, stderr = '') {
        super(message)
        this.name = 'GitExecError'
        this.code = code
        this.exitCode = exitCode
        this.stderr = stderr
    }
}

// Spec §5 read allowlist. `tag` is further restricted to list mode below — a bare
// `git tag <name>` would CREATE a tag, which the non-invasive contract forbids.
const ALLOWED_SUBCOMMANDS = new Set([
    'rev-parse',
    'rev-list',
    'log',
    'show',
    'diff',
    'merge-base',
    'for-each-ref',
    'tag',
    'patch-id',
    'status'
])

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024

export type GitExecOptions = {
    timeoutMs?: number
    maxOutputBytes?: number
    /** Exit codes to treat as success, e.g. [1] for `merge-base --is-ancestor` boolean answers. */
    allowExitCodes?: number[]
    /** Piped to the child's stdin (used by `patch-id`, which reads a diff from stdin). */
    stdin?: string
}

export type GitExecResult = {
    stdout: string
    exitCode: number
}

function resolveTimeoutMs(override?: number): number {
    if (override && override > 0) return override
    const fromEnv = Number(process.env.MEMORIA_GIT_TIMEOUT_MS)
    return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_TIMEOUT_MS
}

function assertAllowed(args: string[]): void {
    const subcommand = args[0]
    // Position 0 must be the subcommand itself: global flags before it (-C, -c, --git-dir, …)
    // could redirect or reconfigure git and are rejected wholesale.
    if (!subcommand || subcommand.startsWith('-') || !ALLOWED_SUBCOMMANDS.has(subcommand)) {
        throw new GitExecError(
            'git_command_not_allowed',
            `git subcommand not allowed by the read-only contract: ${subcommand ?? '(none)'}`
        )
    }
    if (subcommand === 'tag' && !args.some((a) => a === '-l' || a === '--list')) {
        throw new GitExecError(
            'git_command_not_allowed',
            'git tag is only allowed in list mode (-l/--list); creating tags is forbidden'
        )
    }
}

function classifyFailure(exitCode: number | null, stderr: string): GitExecError {
    if (/not a git repository/i.test(stderr)) {
        return new GitExecError('not_a_git_repository', 'path is not a git repository', exitCode, stderr)
    }
    return new GitExecError(
        'git_command_failed',
        `git exited with code ${exitCode ?? 'null'}: ${stderr.trim().slice(0, 500)}`,
        exitCode,
        stderr
    )
}

/**
 * Run a read-only git command in `cwd` and resolve with its stdout.
 * Rejects with GitExecError for disallowed subcommands, non-zero exits, and timeouts.
 */
export function runGit(cwd: string, args: string[], options: GitExecOptions = {}): Promise<GitExecResult> {
    assertAllowed(args)
    const timeoutMs = resolveTimeoutMs(options.timeoutMs)
    const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES

    return new Promise((resolve, reject) => {
        const child = spawn('git', args, {
            cwd,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
                ...process.env,
                LC_ALL: 'C',
                GIT_TERMINAL_PROMPT: '0',
                GIT_OPTIONAL_LOCKS: '0'
            }
        })

        let stdout = ''
        let stderr = ''
        let outputBytes = 0
        let settled = false

        const fail = (error: GitExecError) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            reject(error)
        }
        const succeed = (result: GitExecResult) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            resolve(result)
        }

        const timer = setTimeout(() => {
            try { child.kill('SIGKILL') } catch { /* already gone */ }
            fail(new GitExecError('git_timeout', `git ${args[0]} timed out after ${timeoutMs}ms`))
        }, timeoutMs)

        child.stdout.on('data', (chunk: Buffer) => {
            outputBytes += chunk.length
            if (outputBytes > maxOutputBytes) {
                try { child.kill('SIGKILL') } catch { /* already gone */ }
                fail(new GitExecError('git_command_failed', `git ${args[0]} output exceeded ${maxOutputBytes} bytes`))
                return
            }
            stdout += chunk
        })
        child.stderr.on('data', (chunk: Buffer) => { stderr += chunk })
        child.on('error', (error) => {
            fail(new GitExecError('git_command_failed', `failed to spawn git: ${error.message}`))
        })
        child.on('close', (code) => {
            const exitCode = code ?? -1
            if (exitCode === 0 || options.allowExitCodes?.includes(exitCode)) {
                succeed({ stdout, exitCode })
                return
            }
            fail(classifyFailure(code, stderr))
        })

        if (options.stdin !== undefined) child.stdin.end(options.stdin)
        else child.stdin.end()
    })
}
