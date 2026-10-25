import { readFile } from 'node:fs/promises';
declare const __MEMORIA_UI_JS__: string;
declare const __MEMORIA_UI_CSS__: string;
export async function uiAssets(): Promise<Record<string, {
    type: string;
    body: string;
}>> {
    // Production injects the assets at build time; source checkouts use the existing dev tool.
    const script = typeof __MEMORIA_UI_JS__ !== 'undefined' ? __MEMORIA_UI_JS__ :
        (await (await import('esbuild')).build({ entryPoints: [new URL('./app.ts', import.meta.url).pathname], bundle: true, write: false, format: 'iife', target: 'es2022' })).outputFiles[0].text;
    const css = typeof __MEMORIA_UI_CSS__ !== 'undefined' ? __MEMORIA_UI_CSS__ : await readFile(new URL('./style.css', import.meta.url), 'utf8');
    return {
        '/ui/': { type: 'text/html; charset=utf-8', body: '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Memoria · 記憶工作台</title><link rel="stylesheet" href="/ui/style.css"><script src="/ui/app.js" defer></script></head><body><div id="app"><p>正在開啟記憶工作台…</p></div><noscript>請啟用 JavaScript 以瀏覽本機記憶。</noscript></body></html>' },
        '/ui/app.js': { type: 'text/javascript; charset=utf-8', body: script },
        '/ui/style.css': { type: 'text/css; charset=utf-8', body: css }
    };
}
