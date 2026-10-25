#!/usr/bin/env node
import { build } from 'esbuild'
import { chmod, readFile } from 'node:fs/promises'

const OUTFILE = 'dist/cli.mjs'

const browserBuild = await build({entryPoints:['src/ui/app.ts'],bundle:true,write:false,format:'iife',target:'es2022',minify:true})
const uiScript = browserBuild.outputFiles[0].text
const uiCss = await readFile('src/ui/style.css','utf8')

const pkg = JSON.parse(await readFile('package.json', 'utf8'))

await build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  external: ['better-sqlite3'],
  // Bake the package.json version into the bundle so the CLI has a single source of truth.
  define: { __MEMORIA_VERSION__: JSON.stringify(pkg.version), __MEMORIA_UI_JS__: JSON.stringify(uiScript), __MEMORIA_UI_CSS__: JSON.stringify(uiCss) },
  banner: {
    js: `#!/usr/bin/env node\nimport { createRequire } from 'node:module';const require = createRequire(import.meta.url);`
  },
  outfile: OUTFILE
})

await chmod(OUTFILE, 0o755)
console.log(`✓ Built ${OUTFILE}`)
