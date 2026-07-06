// Memoria HTTP Server
// Serves the MemoriaCore API over HTTP (node:http, zero extra deps)
// Default port: 3917 (override with MEMORIA_PORT env var)
//
// Routes (11 endpoints):
//   GET  /v1/health
//   GET  /v1/stats
//   GET  /v1/telemetry/recall?window=P7D&limit=100
//   POST /v1/remember              body: SessionData JSON
//   POST /v1/recall                body: RecallFilter JSON
//   POST /v1/sources               body: { filePath, type?, title?, scope? }
//   GET  /v1/sources?type=&scope=&limit=
//   POST /v1/wiki/build
//   POST /v1/wiki/file-query       body: { query, title, kind?, scope?, top_k?, ... }
//   POST /v1/wiki/lint             body: { stale_days?, limit? } (empty body allowed)
//   GET  /v1/sessions/:id/summary

import http from 'node:http'
import { z } from 'zod'
import { MemoriaCore } from './core/index.js'
import { resolveMemoriaPaths } from './core/index.js'
import type { IncomingMessage, ServerResponse } from 'node:http'

const DEFAULT_PORT = 3917

// Cap request body size to avoid unbounded memory growth from a malicious/oversized
// payload. Override with MEMORIA_MAX_BODY_BYTES (bytes); falls back to 1 MiB.
function resolveMaxBodyBytes(): number {
    const raw = process.env.MEMORIA_MAX_BODY_BYTES
    const parsed = raw ? Number(raw) : NaN
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1024 * 1024
}
const MAX_BODY_BYTES = resolveMaxBodyBytes()

// ─── Request body schemas (validate at the HTTP boundary; unknown → parse) ──────
// Known fields are type-checked; extra fields pass through for forward compatibility.

const recallModeSchema = z.enum(['keyword', 'tree', 'hybrid'])

const rememberSchema = z
    .object({
        id: z.string().optional(),
        timestamp: z.string().optional(),
        project: z.string().optional(),
        scope: z.string().optional(),
        summary: z.string().optional(),
        events: z
            .array(z.object({
                id: z.string().optional(),
                timestamp: z.string().optional(),
                type: z.string().optional(),
                event_type: z.string().optional(),
                content: z.unknown().optional(),
                metadata: z.unknown().optional()
            }).passthrough())
            .optional()
    })
    .passthrough()

const recallSchema = z
    .object({
        query: z.string(),
        project: z.string().optional(),
        scope: z.string().optional(),
        top_k: z.number().optional(),
        time_window: z.string().optional(),
        mode: recallModeSchema.optional()
    })
    .passthrough()

const sourcesSchema = z
    .object({
        filePath: z.string(),
        type: z.enum(['note', 'article', 'document']).optional(),
        title: z.string().optional(),
        scope: z.string().optional()
    })
    .passthrough()

const fileQuerySchema = z
    .object({
        query: z.string(),
        title: z.string(),
        kind: z.enum(['synthesis', 'comparison']).optional(),
        scope: z.string().optional(),
        top_k: z.number().optional(),
        time_window: z.string().optional(),
        mode: recallModeSchema.optional()
    })
    .passthrough()

const wikiLintSchema = z
    .object({
        stale_days: z.number().optional(),
        limit: z.number().optional()
    })
    .passthrough()

// Reads the request body, capped at MAX_BODY_BYTES. On overflow it sends a 413 itself
// (the caller must NOT write another response) and rejects with { statusCode: 413,
// responded: true }. Remaining inbound data is drained and discarded — memory stays
// bounded — so the client reliably receives the 413 instead of a connection reset.
function readBody(req: IncomingMessage, res: ServerResponse): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = []
        let size = 0
        let overflowed = false
        req.on('data', (c: Buffer) => {
            if (overflowed) return
            size += c.length
            if (size > MAX_BODY_BYTES) {
                overflowed = true
                sendError(res, 413, `Request body exceeds ${MAX_BODY_BYTES} bytes`)
                reject(Object.assign(new Error('Request body too large'), { statusCode: 413, responded: true }))
                req.resume() // drain and discard the rest so the socket closes cleanly
                return
            }
            chunks.push(c)
        })
        req.on('end', () => { if (!overflowed) resolve(Buffer.concat(chunks).toString('utf8')) })
        req.on('error', (err) => { if (!overflowed) reject(err) })
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

function formatZodError(error: z.ZodError): string {
    return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
}

/**
 * Read a JSON request body and validate it against a Zod schema. Sends a 400 and
 * returns null on invalid JSON or schema failure; otherwise returns the parsed value.
 * When allowEmpty is set, an empty body validates as `{}`.
 */
async function readValidatedBody<S extends z.ZodTypeAny>(
    req: IncomingMessage,
    res: ServerResponse,
    schema: S,
    opts: { allowEmpty?: boolean } = {}
): Promise<z.infer<S> | null> {
    let raw: string
    try {
        raw = await readBody(req, res)
    } catch (error) {
        // readBody already sent the 413 response on overflow; just stop here.
        if (error && typeof error === 'object' && (error as { responded?: boolean }).responded) {
            return null
        }
        throw error
    }
    let value: unknown
    if (!raw.trim()) {
        if (!opts.allowEmpty) {
            sendError(res, 400, 'Invalid JSON body')
            return null
        }
        value = {}
    } else {
        try {
            value = JSON.parse(raw)
        } catch {
            sendError(res, 400, 'Invalid JSON body')
            return null
        }
    }
    const result = schema.safeParse(value)
    if (!result.success) {
        sendError(res, 400, `Invalid request body: ${formatZodError(result.error)}`)
        return null
    }
    return result.data
}

export function createServer(core: MemoriaCore): http.Server {
    return http.createServer(async (req, res) => {
        const method = req.method ?? 'GET'
        const rawUrl = req.url ?? '/'
        const parsedUrl = new URL(rawUrl, 'http://localhost')
        const pathname = parsedUrl.pathname

        try {
            // GET /v1/health
            if (method === 'GET' && pathname === '/v1/health') {
                const result = await core.health()
                send(res, result.ok ? 200 : 503, result)
                return
            }

            // GET /v1/stats
            if (method === 'GET' && pathname === '/v1/stats') {
                const result = await core.stats()
                send(res, result.ok ? 200 : 500, result)
                return
            }

            // GET /v1/telemetry/recall
            if (method === 'GET' && pathname === '/v1/telemetry/recall') {
                const window = parsedUrl.searchParams.get('window') ?? undefined
                const limitRaw = parsedUrl.searchParams.get('limit')
                const limit = limitRaw ? Number(limitRaw) : undefined
                if (limitRaw && !Number.isFinite(limit)) {
                    sendError(res, 400, 'Invalid limit query param; expected number')
                    return
                }
                const result = await core.recallTelemetry({ window, limit })
                send(res, result.ok ? 200 : 500, result)
                return
            }

            // POST /v1/remember
            if (method === 'POST' && pathname === '/v1/remember') {
                const body = await readValidatedBody(req, res, rememberSchema)
                if (body === null) return
                const result = await core.remember(body as Parameters<typeof core.remember>[0])
                send(res, result.ok ? 200 : 500, result)
                return
            }

            // POST /v1/recall
            if (method === 'POST' && pathname === '/v1/recall') {
                const body = await readValidatedBody(req, res, recallSchema)
                if (body === null) return
                const result = await core.recall(body as Parameters<typeof core.recall>[0])
                send(res, result.ok ? 200 : 500, result)
                return
            }

            if (method === 'POST' && pathname === '/v1/sources') {
                const body = await readValidatedBody(req, res, sourcesSchema)
                if (body === null) return
                const result = await core.addSource(body as Parameters<typeof core.addSource>[0])
                send(res, result.ok ? 200 : 500, result)
                return
            }

            if (method === 'GET' && pathname === '/v1/sources') {
                const type = parsedUrl.searchParams.get('type') ?? undefined
                const scope = parsedUrl.searchParams.get('scope') ?? undefined
                const limitRaw = parsedUrl.searchParams.get('limit')
                const limit = limitRaw ? Number(limitRaw) : undefined
                if (limitRaw && !Number.isFinite(limit)) {
                    sendError(res, 400, 'Invalid limit query param; expected number')
                    return
                }
                const result = await core.listSources({ type, scope, limit })
                send(res, result.ok ? 200 : 500, result)
                return
            }

            if (method === 'POST' && pathname === '/v1/wiki/build') {
                const result = await core.buildWiki()
                send(res, result.ok ? 200 : 500, result)
                return
            }

            if (method === 'POST' && pathname === '/v1/wiki/file-query') {
                const body = await readValidatedBody(req, res, fileQuerySchema)
                if (body === null) return
                const result = await core.fileQuery(body as Parameters<typeof core.fileQuery>[0])
                send(res, result.ok ? 200 : 500, result)
                return
            }

            if (method === 'POST' && pathname === '/v1/wiki/lint') {
                const body = await readValidatedBody(req, res, wikiLintSchema, { allowEmpty: true })
                if (body === null) return
                const result = await core.wikiLint(body as Parameters<typeof core.wikiLint>[0])
                send(res, result.ok ? 200 : 500, result)
                return
            }

            // GET /v1/sessions/:id/summary
            const sessionMatch = /^\/v1\/sessions\/([^/]+)\/summary$/.exec(pathname)
            if (method === 'GET' && sessionMatch) {
                const sessionId = decodeURIComponent(sessionMatch[1])
                const result = await core.summarizeSession(sessionId)
                send(res, result.ok ? 200 : (result.error?.includes('not found') ? 404 : 500), result)
                return
            }

            sendError(res, 404, `Not found: ${method} ${rawUrl}`)
        } catch (error) {
            sendError(res, 500, error instanceof Error ? error.message : String(error))
        }
    })
}

export async function startServer(port?: number, memoriaHomeOverride?: string): Promise<{ server: http.Server; port: number }> {
    const paths = resolveMemoriaPaths(memoriaHomeOverride)
    const core = new MemoriaCore(paths)
    const actualPort = port ?? Number(process.env.MEMORIA_PORT ?? DEFAULT_PORT)

    const server = createServer(core)

    await new Promise<void>((resolve) => server.listen(actualPort, resolve))

    return { server, port: (server.address() as { port: number }).port }
}
