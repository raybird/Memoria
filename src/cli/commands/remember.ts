import type { Command } from 'commander'
import type { MemoriaCore } from '../../core/index.js'

const NOTE_TYPES = ['decision', 'skill'] as const
type NoteType = (typeof NOTE_TYPES)[number]

type RememberCommandOptions = {
    type?: string
    project?: string
    scope?: string
    rationale?: string
    category?: string
    json?: boolean
}

export function registerRememberCommand(program: Command, core: MemoriaCore): void {
    program
        .command('remember')
        .description('Write a single atomic note into memory')
        .argument('<text>', 'Note text')
        .option(`--type <type>`, `Note type: ${NOTE_TYPES.join('|')}`, 'decision')
        .option('--project <name>', 'Project tag written on the note')
        .option('--scope <scope>', 'Memory scope for the note')
        .option('--rationale <text>', 'Why (decision) or pattern (skill)')
        .option('--category <name>', 'Skill category (--type skill only)')
        .option('--json', 'Machine-readable JSON output')
        .action(async (text: string, options: RememberCommandOptions) => {
            const type = (options.type ?? 'decision') as NoteType
            if (!NOTE_TYPES.includes(type)) {
                throw new Error(`Invalid --type '${options.type}'. Use: ${NOTE_TYPES.join('|')}`)
            }

            const result = await core.rememberNote({
                text,
                type,
                project: options.project,
                scope: options.scope,
                rationale: options.rationale,
                category: options.category
            })
            if (!result.ok) throw new Error(result.error)

            if (options.json) {
                console.log(JSON.stringify(result))
            } else {
                const data = result.data
                console.log(`${data?.created ? '✓ 已記住' : '✓ 已存在（內容相同，未新增）'}: ${data?.sessionId}`)
                console.log(`- type: ${data?.type}`)
                console.log(`- event: ${data?.eventId}`)
            }
        })
}
