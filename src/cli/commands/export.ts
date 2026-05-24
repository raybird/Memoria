import type { Command } from 'commander'
import { exportMemory } from '../../core/index.js'
import type { MemoriaPaths, ExportOptions, ExportType, ExportFormat } from '../../core/index.js'

export function registerExportCommand(program: Command, paths: MemoriaPaths): void {
    program
        .command('export')
        .description('Export decisions/skills by time range and project')
        .option('--from <isoDate>', 'Include records at/after this ISO date')
        .option('--to <isoDate>', 'Include records at/before this ISO date')
        .option('--project <name>', 'Filter by project name')
        .option('--scope <name>', 'Filter by memory scope')
        .option('--type <type>', 'Export type: all|decisions|skills', 'all')
        .option('--format <fmt>', 'Output format: json|markdown', 'json')
        .option('--out <path>', 'Output directory (default: .memory/exports)')
        .option('--json', 'Machine-readable summary output')
        .action(async (options: ExportOptions & { json?: boolean }) => {
            const type = (options.type ?? 'all') as ExportType
            const format = (options.format ?? 'json') as ExportFormat
            if (!['all', 'decisions', 'skills'].includes(type)) {
                throw new Error(`Invalid --type '${options.type}'. Use: all|decisions|skills`)
            }
            if (!['json', 'markdown'].includes(format)) {
                throw new Error(`Invalid --format '${options.format}'. Use: json|markdown`)
            }
            const result = await exportMemory(paths, { ...options, type, format })

            if (options.json) {
                console.log(JSON.stringify({ ok: true, filePath: result.filePath, decisions: result.decisions.length, skills: result.skills.length }))
            } else {
                console.log('📦 Memoria Export complete')
                console.log(`- file: ${result.filePath}`)
                console.log(`- decisions: ${result.decisions.length}`)
                console.log(`- skills: ${result.skills.length}`)
            }
        })
}
