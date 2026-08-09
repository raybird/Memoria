import type { Command } from 'commander'
import type { MemoriaCore } from '../../core/index.js'

const NOTE_TYPES = ['decision', 'skill'] as const
type NoteType = (typeof NOTE_TYPES)[number]

const SENSITIVITIES = ['private', 'shareable'] as const

type RememberCommandOptions = {
    type?: string
    project?: string
    scope?: string
    rationale?: string
    category?: string
    durable?: boolean
    episodic?: boolean
    sensitivity?: string
    supersedes?: string
    supersedeNote?: string
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
        .option('--durable', 'Evergreen fact: exempt from time-decay and stale pruning')
        .option('--episodic', 'Explicitly time-bound (the default when neither flag is given)')
        .option(`--sensitivity <level>`, `Mark sensitivity: ${SENSITIVITIES.join('|')} (drives export --redact)`)
        .option('--supersedes <refId>', 'Mark an existing memory as replaced by this note')
        .option('--supersede-note <text>', 'Why the superseded memory was replaced')
        .option('--json', 'Machine-readable JSON output')
        .action(async (text: string, options: RememberCommandOptions) => {
            const type = (options.type ?? 'decision') as NoteType
            if (!NOTE_TYPES.includes(type)) {
                throw new Error(`Invalid --type '${options.type}'. Use: ${NOTE_TYPES.join('|')}`)
            }

            if (options.durable && options.episodic) {
                throw new Error('--durable and --episodic are mutually exclusive')
            }
            if (options.sensitivity && !SENSITIVITIES.includes(options.sensitivity as (typeof SENSITIVITIES)[number])) {
                throw new Error(`Invalid --sensitivity '${options.sensitivity}'. Use: ${SENSITIVITIES.join('|')}`)
            }

            const result = await core.rememberNote({
                text,
                type,
                project: options.project,
                scope: options.scope,
                rationale: options.rationale,
                category: options.category,
                retention: options.durable ? 'durable' : options.episodic ? 'episodic' : undefined,
                sensitivity: options.sensitivity as 'private' | 'shareable' | undefined,
                supersedes: options.supersedes,
                supersedeNote: options.supersedeNote
            })
            if (!result.ok) throw new Error(result.error)

            if (options.json) {
                console.log(JSON.stringify(result))
            } else {
                const data = result.data
                console.log(`${data?.created ? '✓ 已記住' : '✓ 已存在（內容相同，未新增）'}: ${data?.sessionId}`)
                console.log(`- type: ${data?.type}`)
                console.log(`- event: ${data?.eventId}`)
                if (options.durable) console.log('- retention: durable（不衰減、不被 stale 裁剪）')
                if (options.sensitivity) console.log(`- sensitivity: ${options.sensitivity}`)
                if (data?.superseded?.length) console.log(`- 已標記取代: ${data.superseded.join(', ')}`)
            }
        })
}
