/**
 * Bundle the Host half into `lib/index.js` (plain ESM for Node). The Web UI is
 * built separately by Vite into `dist/`, which the Host half serves.
 */
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outfile = resolve(root, 'lib/index.js')

await build({
  entryPoints: [resolve(root, 'src/host/index.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  external: ['@deepseek-ai/*'],
  legalComments: 'none',
  logLevel: 'warning',
})

const host = await readFile(outfile, 'utf8')
if (!/\bexport\s*\{[^}]*\bapply\b/.test(host)) {
  throw new Error('lib/index.js does not export apply; the Loader cannot mount the row')
}
