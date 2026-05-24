#!/usr/bin/env node
import { build } from 'esbuild'
import { chmod } from 'node:fs/promises'

const OUTFILE = 'dist/cli.mjs'

await build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  external: ['better-sqlite3'],
  banner: {
    js: `#!/usr/bin/env node\nimport { createRequire } from 'node:module';const require = createRequire(import.meta.url);`
  },
  outfile: OUTFILE
})

await chmod(OUTFILE, 0o755)
console.log(`✓ Built ${OUTFILE}`)
