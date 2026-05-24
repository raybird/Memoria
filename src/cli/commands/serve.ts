import type { Command } from 'commander'

export function registerServeCommand(program: Command): void {
    program
        .command('serve')
        .description('Start Memoria HTTP API server')
        .option('--port <port>', 'Port to listen on (default: 3917 or MEMORIA_PORT)')
        .option('--json', 'Emit JSON status line on startup')
        .action(async (opts: { port?: string; json?: boolean }) => {
            const { startServer } = await import('../../server.js')
            const port = opts.port ? Number(opts.port) : undefined
            const { server, port: actualPort } = await startServer(port)

            if (opts.json) {
                console.log(JSON.stringify({ ok: true, step: 'serve', port: actualPort }))
            } else {
                console.log(`🚀 Memoria server listening on http://localhost:${actualPort}`)
                console.log('   GET  /v1/health')
                console.log('   GET  /v1/stats')
                console.log('   GET  /v1/telemetry/recall?window=P7D&limit=100')
                console.log('   POST /v1/remember')
                console.log('   POST /v1/recall')
                console.log('   GET  /v1/sessions/:id/summary')
                console.log('   Ctrl+C to stop')
            }

            const shutdown = () => {
                server.close()
                process.exit(0)
            }
            process.on('SIGINT', shutdown)
            process.on('SIGTERM', shutdown)
        })
}
