import type { Command } from 'commander'
import { closeAllConnections } from '../../core/index.js'

export function registerServeCommand(program: Command): void {
    program
        .command('serve')
        .description('Start Memoria HTTP API server')
        .option('--port <port>', 'Port to listen on (default: 3917 or MEMORIA_PORT)')
        .option('--ui', 'Open the local read-only memory workspace (127.0.0.1 only)')
        .option('--json', 'Emit JSON status line on startup')
        .action(async (opts: { port?: string; json?: boolean; ui?: boolean }) => {
            const { startServer } = await import('../../server.js')
            const port = opts.port ? Number(opts.port) : undefined
            const { server, port: actualPort } = await startServer(port, undefined, { ui: opts.ui })

            if (opts.json) {
                console.log(JSON.stringify({ ok: true, step: 'serve', port: actualPort, ...(opts.ui ? { url: `http://127.0.0.1:${actualPort}/ui/` } : {}) }))
            } else {
                console.log(opts.ui ? `Memoria 記憶工作台：http://127.0.0.1:${actualPort}/ui/` : `🚀 Memoria server listening on http://localhost:${actualPort}`)
                if (opts.ui) console.log('   本機唯讀瀏覽 · Ctrl+C 關閉')
                else {
                console.log('   GET  /v1/health')
                console.log('   GET  /v1/stats')
                console.log('   GET  /v1/telemetry/recall?window=P7D&limit=100')
                console.log('   POST /v1/remember')
                console.log('   POST /v1/recall')
                console.log('   POST /v1/recall/:id/outcome')
                console.log('   POST /v1/sources')
                console.log('   GET  /v1/sources')
                console.log('   POST /v1/wiki/build')
                console.log('   POST /v1/wiki/file-query')
                console.log('   POST /v1/wiki/lint')
                console.log('   GET  /v1/sessions/:id/summary')
                console.log('   Ctrl+C to stop')
                }
            }

            const shutdown = () => {
                server.close()
                closeAllConnections()
                process.exit(0)
            }
            process.on('SIGINT', shutdown)
            process.on('SIGTERM', shutdown)
        })
}
