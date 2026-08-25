import type { Command } from 'commander'
import type { MemoriaCore } from '../../core/index.js'
import type { MemoryAttributePatch } from '../../core/index.js'

const SENSITIVITIES = ['private', 'shareable'] as const

type MarkCommandOptions = {
    durable?: boolean
    episodic?: boolean
    sensitivity?: string
    note?: string
    json?: boolean
}

/** Apply long-term memory markers to a memory that already exists (docs/issues/issue-17).
 *
 *  Flag semantics deliberately mirror `remember`, so the two surfaces cannot drift: the same
 *  `--durable` means the same thing whether it is written at creation or applied afterwards. */
export function registerMarkCommand(program: Command, core: MemoriaCore): void {
    program
        .command('mark')
        .description('Apply long-term memory markers to an existing memory')
        .argument('<refId>', 'Memory ref id (a session id or an event id, e.g. from recall --json)')
        .option('--durable', 'Evergreen fact: exempt from time-decay and stale pruning')
        .option('--episodic', 'Explicitly time-bound')
        .option(`--sensitivity <level>`, `Mark sensitivity: ${SENSITIVITIES.join('|')} (drives export --redact)`)
        .option('--note <text>', 'Why this marker was applied')
        .option('--json', 'Machine-readable JSON output')
        .action(async (refId: string, options: MarkCommandOptions) => {
            if (options.durable && options.episodic) {
                throw new Error('--durable and --episodic are mutually exclusive')
            }
            if (options.sensitivity && !SENSITIVITIES.includes(options.sensitivity as (typeof SENSITIVITIES)[number])) {
                throw new Error(`Invalid --sensitivity '${options.sensitivity}'. Use: ${SENSITIVITIES.join('|')}`)
            }

            const patch: MemoryAttributePatch = {
                ...(options.durable ? { retention: 'durable' as const } : {}),
                ...(options.episodic ? { retention: 'episodic' as const } : {}),
                ...(options.sensitivity ? { sensitivity: options.sensitivity as 'private' | 'shareable' } : {}),
                ...(options.note ? { note: options.note } : {})
            }

            const result = await core.markMemory(refId, patch)
            if (!result.ok) throw new Error(result.error)

            if (options.json) {
                console.log(JSON.stringify(result))
            } else {
                console.log(`✓ 已標記: ${result.data?.refId}`)
                if (options.durable) console.log('- retention: durable（不衰減、不被 stale 裁剪）')
                if (options.episodic) console.log('- retention: episodic（依時間衰減）')
                if (options.sensitivity) console.log(`- sensitivity: ${options.sensitivity}`)
            }
        })
}
