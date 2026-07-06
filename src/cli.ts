import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Command } from 'commander'
import { MemoriaCore, resolveMemoriaPaths } from './core/index.js'
import { getRuntimeLayout } from './cli/runtime.js'
import { registerInitCommand } from './cli/commands/init.js'
import { registerSyncCommand } from './cli/commands/sync.js'
import { registerSourceCommand } from './cli/commands/source.js'
import { registerWikiCommand } from './cli/commands/wiki.js'
import { registerStatsCommand } from './cli/commands/stats.js'
import { registerIndexCommand } from './cli/commands/index-cmd.js'
import { registerGovernCommand } from './cli/commands/govern.js'
import { registerDoctorCommand } from './cli/commands/doctor.js'
import { registerVerifyCommand } from './cli/commands/verify.js'
import { registerPruneCommand } from './cli/commands/prune.js'
import { registerExportCommand } from './cli/commands/export.js'
import { registerServeCommand } from './cli/commands/serve.js'
import { registerPreflightCommand } from './cli/commands/preflight-cmd.js'
import { registerSetupCommand } from './cli/commands/setup.js'
import { registerAdapterCommand } from './cli/commands/adapter.js'

// Injected by esbuild (scripts/build.mjs) from package.json in the production bundle.
// In dev (tsx), the define is absent, so fall back to reading package.json at runtime.
declare const __MEMORIA_VERSION__: string | undefined

function resolveVersion(): string {
  if (typeof __MEMORIA_VERSION__ === 'string') return __MEMORIA_VERSION__
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    return (JSON.parse(readFileSync(join(here, '../package.json'), 'utf8')) as { version: string }).version
  } catch {
    return '0.0.0-dev'
  }
}

async function run(): Promise<void> {
  const paths = resolveMemoriaPaths()
  const runtimeLayout = getRuntimeLayout()
  const core = new MemoriaCore(paths)

  const program = new Command()
    .name('memoria')
    .description('Memoria TypeScript CLI')
    .version(resolveVersion())

  registerInitCommand(program, paths, core)
  registerSyncCommand(program, paths, core)
  registerSourceCommand(program, core)
  registerWikiCommand(program, core)
  registerStatsCommand(program, paths, core)
  registerIndexCommand(program, paths)
  registerGovernCommand(program, core)
  registerDoctorCommand(program, paths)
  registerVerifyCommand(program, paths)
  registerPruneCommand(program, paths)
  registerExportCommand(program, paths)
  registerServeCommand(program)
  registerPreflightCommand(program, paths, runtimeLayout)
  registerSetupCommand(program, runtimeLayout)
  registerAdapterCommand(program)

  await program.parseAsync(process.argv)
}

run().catch((error) => {
  console.error('❌ 執行失敗:', error instanceof Error ? error.message : error)
  process.exit(1)
})
