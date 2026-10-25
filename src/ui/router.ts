import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import type { MemoriaCore, MemoryKind } from '../core/index.js';
import { memoryFilterSchema, memorySearchSchema } from '../core/index.js';
import { uiAssets } from './assets.js';
type Assets = Awaited<ReturnType<typeof uiAssets>>;
function json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
}
function reject(res: ServerResponse, status: number, error: string): void {
    json(res, status, { ok: false, error, meta: { source: 'ui', evidence: [], confidence: 0, timestamp: new Date().toISOString(), latency_ms: 0 } });
}
export async function createUiRouter(core: MemoriaCore): Promise<(req: IncomingMessage, res: ServerResponse) => Promise<void>> {
    const assets: Assets = await uiAssets();
    return async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
        const address = req.socket.localAddress;
        const host = `127.0.0.1:${req.socket.localPort}`;
        const origin = `http://${host}`;
        // Launches from another app may be cross-site navigations. This shell contains no memory;
        // scripts, embedded frames and every data endpoint still require the normal same-origin gate.
        const entryNavigation = req.method === 'GET' && req.url?.split('?')[0] === '/ui/' && req.headers.origin === undefined &&
            req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document';
        if (address !== '127.0.0.1' || req.headers.host !== host ||
            (req.headers.origin !== undefined && req.headers.origin !== origin) ||
            (!entryNavigation && req.headers['sec-fetch-site'] !== undefined && !['same-origin', 'none'].includes(String(req.headers['sec-fetch-site'])))) {
            reject(res, 403, 'Only the printed local UI address and same-origin requests are allowed');
            return;
        }
        try {
            const url = new URL(req.url ?? '/', origin);
            const method = req.method ?? 'GET';
            if (method === 'GET' && url.pathname === '/') {
                res.writeHead(302, { Location: '/ui/' });
                res.end();
                return;
            }
            if (method === 'GET' && assets[url.pathname]) {
                const asset = assets[url.pathname];
                res.writeHead(200, { 'Content-Type': asset.type });
                res.end(asset.body);
                return;
            }
            if (method === 'POST' && url.pathname === '/v1/ui/search') {
                const chunks: Buffer[] = [];
                let bytes = 0;
                for await (const chunk of req) {
                    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                    bytes += buffer.length;
                    if (bytes > 16384) {
                        reject(res, 413, 'Search request too large');
                        return;
                    }
                    chunks.push(buffer);
                }
                const input = memorySearchSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
                const result = await core.searchMemories(input);
                if (!res.destroyed)
                    json(res, result.ok ? 200 : 500, result);
                return;
            }
            if (method !== 'GET') {
                reject(res, 405, 'This UI is read-only; only explicit search is allowed');
                return;
            }
            if (url.pathname === '/v1/memory-facets') {
                const result = await core.memoryFacets();
                json(res, result.ok ? 200 : 500, result);
                return;
            }
            if (url.pathname === '/v1/memories') {
                const integer = (key: string) => url.searchParams.has(key) ? Number(url.searchParams.get(key)) : undefined;
                const boolean = (key: string) => { const v = url.searchParams.get(key); if (v !== null && !['true', 'false'].includes(v))
                    throw new Error(`Invalid ${key}`); return v === 'true'; };
                const filter = memoryFilterSchema.parse({ type: url.searchParams.get('type') ?? undefined, project: url.searchParams.get('project') ?? undefined,
                    environment: boolean('environment'), durable: boolean('durable'), include_superseded: boolean('include_superseded'), page: integer('page'), page_size: integer('page_size') });
                const result = await core.listMemories(filter);
                json(res, result.ok ? 200 : 500, result);
                return;
            }
            const match = /^\/v1\/memories\/([^/]+)$/.exec(url.pathname);
            if (match) {
                const type = url.searchParams.get('type') ?? undefined;
                if (type !== undefined)
                    z.enum(['decision', 'skill', 'session']).parse(type);
                const result = await core.getMemory(decodeURIComponent(match[1]), type as MemoryKind | undefined);
                json(res, result.ok ? 200 : result.error === 'memory not found' ? 404 : 500, result);
                return;
            }
            if (url.pathname === '/v1/brief') {
                const result = await core.brief({ project: url.searchParams.get('project') ?? undefined }, { initialize: false });
                json(res, result.ok ? 200 : 500, result);
                return;
            }
            reject(res, 404, 'Not found');
        }
        catch (error) {
            reject(res, 400, error instanceof Error ? error.message : 'Invalid request');
        }
    };
}
