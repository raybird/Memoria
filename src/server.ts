// Memoria HTTP Server
// Serves the MemoriaCore API over HTTP (node:http, zero extra deps)
// Default port: 3917 (override with MEMORIA_PORT env var)
//
// Routes:
//   GET  /v1/health
//   GET  /v1/stats
//   POST /v1/remember          body: SessionData JSON
//   POST /v1/recall            body: RecallFilter JSON
//   GET  /v1/sessions/:id/summary

import http from 'node:http'
import { MemoriaCore } from './core/index.js'
import { resolveMemoriaPaths } from './core/index.js'
import type { IncomingMessage, ServerResponse } from 'node:http'

const DEFAULT_PORT = 3917

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
        req.on('error', reject)
    })
}

function send(res: ServerResponse, status: number, body: unknown): void {
    const json = JSON.stringify(body, null, 2)
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(json)
}

function sendError(res: ServerResponse, status: number, message: string): void {
    send(res, status, { ok: false, error: message })
}

export function createServer(core: MemoriaCore): http.Server {
    return http.createServer(async (req, res) => {
        const method = req.method ?? 'GET'
        const url = req.url ?? '/'

        try {
            // GET /v1/health
            if (method === 'GET' && url === '/v1/health') {
                const result = await core.health()
                send(res, result.ok ? 200 : 503, result)
                return
            }

            // GET /v1/stats
            if (method === 'GET' && url === '/v1/stats') {
                const result = await core.stats()
                send(res, result.ok ? 200 : 500, result)
                return
            }

            // POST /v1/remember
            if (method === 'POST' && url === '/v1/remember') {
                const raw = await readBody(req)
                let body: unknown
                try { body = JSON.parse(raw) } catch {
                    sendError(res, 400, 'Invalid JSON body')
                    return
                }
                const result = await core.remember(body as Parameters<typeof core.remember>[0])
                send(res, result.ok ? 200 : 500, result)
                return
            }

            // POST /v1/recall
            if (method === 'POST' && url === '/v1/recall') {
                const raw = await readBody(req)
                let body: unknown
                try { body = JSON.parse(raw) } catch {
                    sendError(res, 400, 'Invalid JSON body')
                    return
                }
                if (typeof body !== 'object' || body === null || !('query' in body)) {
                    sendError(res, 400, 'Body must include "query" field')
                    return
                }
                const result = await core.recall(body as Parameters<typeof core.recall>[0])
                send(res, result.ok ? 200 : 500, result)
                return
            }

            // GET /v1/sessions/:id/summary
            const sessionMatch = /^\/v1\/sessions\/([^/]+)\/summary$/.exec(url)
            if (method === 'GET' && sessionMatch) {
                const sessionId = decodeURIComponent(sessionMatch[1])
                const result = await core.summarizeSession(sessionId)
                send(res, result.ok ? 200 : (result.error?.includes('not found') ? 404 : 500), result)
                return
            }

            sendError(res, 404, `Not found: ${method} ${url}`)
        } catch (error) {
            sendError(res, 500, error instanceof Error ? error.message : String(error))
        }
    })
}

export async function startServer(port?: number): Promise<{ server: http.Server; port: number }> {
    const paths = resolveMemoriaPaths()
    const core = new MemoriaCore(paths)
    const actualPort = port ?? Number(process.env.MEMORIA_PORT ?? DEFAULT_PORT)

    const server = createServer(core)

    await new Promise<void>((resolve) => server.listen(actualPort, resolve))

    return { server, port: (server.address() as { port: number }).port }
}
