import { appendFileSync } from 'node:fs'
import type { Command } from 'commander'
import { ClaudeCodeAdapter, CodexAdapter, AntigravityAdapter } from '../../adapter/index.js'
import { MemoriaClient } from '../../sdk.js'

async function readStdin(): Promise<string> {
    if (process.stdin.isTTY) return ''
    let data = ''
    process.stdin.setEncoding('utf8')
    for await (const chunk of process.stdin) data += chunk
    return data
}

/**
 * When MEMORIA_ADAPTER_DEBUG points at a file, append the raw hook payload to it
 * (one JSON line per invocation). Lets you capture the real stdin shape from a host
 * CLI to verify adapter field mappings. Fail-open: never disturbs the hook.
 */
function captureDebugPayload(name: string, raw: string): void {
    const target = process.env.MEMORIA_ADAPTER_DEBUG?.trim()
    if (!target) return
    try {
        appendFileSync(target, JSON.stringify({ adapter: name, received_at: new Date().toISOString(), raw }) + '\n')
    } catch {
        // fail-open: capture must never disturb the hook
    }
}

/** Adapters that handle a stdin→stdout hook exchange share this shape. */
interface HookAdapter {
    handleHookEvent(input: Record<string, unknown>): Promise<unknown>
}
type HookAdapterCtor = new (config: {
    client: MemoriaClient
    project: string
    recallTopK: number
    failOpen: boolean
}) => HookAdapter

/**
 * Register a `memoria adapter <name>` hook handler. Reads one hook JSON object
 * from stdin, dispatches it through the adapter, and writes the JSON response
 * to stdout. Fail-open: any error (or empty stdin) emits `{}` so a Memoria
 * outage never disturbs the host agent's loop.
 */
function registerHookHandler(
    parent: Command,
    name: string,
    description: string,
    defaultProject: string,
    Ctor: HookAdapterCtor
): void {
    parent
        .command(name)
        .description(description)
        .option('--project <name>', `Project tag for written sessions (default: ${defaultProject})`)
        .option('--server <url>', 'Memoria server URL (default: http://localhost:3917 or MEMORIA_SERVER_URL)')
        .option('--recall-top-k <n>', 'Max recall hits to inject (default: 5)')
        .action(async (opts: { project?: string; server?: string; recallTopK?: string }) => {
            const raw = await readStdin()
            captureDebugPayload(name, raw)
            if (!raw.trim()) {
                process.stdout.write('{}\n')
                return
            }

            try {
                const input = JSON.parse(raw) as Record<string, unknown>
                const serverUrl = opts.server ?? process.env.MEMORIA_SERVER_URL ?? 'http://localhost:3917'
                const adapter = new Ctor({
                    client: new MemoriaClient(serverUrl),
                    project: opts.project ?? defaultProject,
                    recallTopK: opts.recallTopK ? Number(opts.recallTopK) : 5,
                    failOpen: true
                })

                const output = await adapter.handleHookEvent(input)
                process.stdout.write(JSON.stringify(output) + '\n')
            } catch {
                // Fail-open: never disturb the agent loop on hook error
                process.stdout.write('{}\n')
            }
        })
}

export function registerAdapterCommand(program: Command): void {
    const adapter = program.command('adapter').description('Agent adapter integrations (hook handlers)')

    registerHookHandler(
        adapter,
        'claude-code',
        'Claude Code hook handler — reads hook JSON from stdin, writes hook JSON to stdout',
        'claude-code',
        ClaudeCodeAdapter
    )
    registerHookHandler(
        adapter,
        'codex',
        'Codex CLI hook handler — reads hook JSON from stdin, writes hook JSON to stdout',
        'codex',
        CodexAdapter
    )
    registerHookHandler(
        adapter,
        'antigravity',
        'Antigravity CLI hook handler — reads hook JSON from stdin, writes hook JSON to stdout',
        'antigravity',
        AntigravityAdapter
    )
}
