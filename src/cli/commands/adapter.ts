import type { Command } from 'commander'
import { ClaudeCodeAdapter } from '../../adapter/index.js'
import { MemoriaClient } from '../../sdk.js'

async function readStdin(): Promise<string> {
    if (process.stdin.isTTY) return ''
    let data = ''
    process.stdin.setEncoding('utf8')
    for await (const chunk of process.stdin) data += chunk
    return data
}

export function registerAdapterCommand(program: Command): void {
    const adapter = program.command('adapter').description('Agent adapter integrations (hook handlers)')

    adapter
        .command('claude-code')
        .description('Claude Code hook handler — reads hook JSON from stdin, writes hook JSON to stdout')
        .option('--project <name>', 'Project tag for written sessions (default: claude-code)')
        .option('--server <url>', 'Memoria server URL (default: http://localhost:3917 or MEMORIA_SERVER_URL)')
        .option('--recall-top-k <n>', 'Max recall hits to inject (default: 5)')
        .action(async (opts: { project?: string; server?: string; recallTopK?: string }) => {
            const raw = await readStdin()
            if (!raw.trim()) {
                process.stdout.write('{}\n')
                return
            }

            try {
                const input = JSON.parse(raw) as Record<string, unknown>
                const serverUrl = opts.server ?? process.env.MEMORIA_SERVER_URL ?? 'http://localhost:3917'
                const adapterInstance = new ClaudeCodeAdapter({
                    client: new MemoriaClient(serverUrl),
                    project: opts.project ?? 'claude-code',
                    recallTopK: opts.recallTopK ? Number(opts.recallTopK) : 5,
                    failOpen: true
                })

                const output = await adapterInstance.handleHookEvent(input)
                process.stdout.write(JSON.stringify(output) + '\n')
            } catch {
                // Fail-open: never disturb the agent loop on hook error
                process.stdout.write('{}\n')
            }
        })
}
