/**
 * Bundle the plugin halves into `lib/`:
 * - `lib/index.js`: the Host half, plain ESM for Node.
 * - `lib/client.js`: the browser half the stock UI loads, a CommonJS body in
 *   the module-loader envelope, with React and DSH packages left to the
 *   shell's shared modules.
 * The M3E Web UI itself is built separately by Vite into `dist/`.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { name: packageId } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as { name: string }

// The Host half records which page it was built with (src/host/index.ts
// DIST_ENTRY), so a page served by a Host that was not restarted after an
// update can say so. `pnpm build` runs Vite first, so dist/ is this build's.
const distIndex = await readFile(resolve(root, 'dist/index.html'), 'utf8')
const distEntry = /<script type="module"[^>]*\ssrc="(\/m3e\/assets\/[^"]+\.js)"/.exec(distIndex)?.[1]
if (distEntry === undefined) throw new Error('dist/index.html has no /m3e/assets entry script; run vite build first')

const hostOut = resolve(root, 'lib/index.js')
await build({
  entryPoints: [resolve(root, 'src/host/index.ts')],
  outfile: hostOut,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  external: ['@deepseek-ai/*'],
  define: { __M3E_DIST_ENTRY__: JSON.stringify(distEntry) },
  legalComments: 'none',
  logLevel: 'warning',
})
const host = await readFile(hostOut, 'utf8')
if (!/\bexport\s*\{[^}]*\bapply\b/.test(host)) {
  throw new Error('lib/index.js does not export apply; the Loader cannot mount the row')
}
if (!host.includes(JSON.stringify(distEntry))) {
  throw new Error('lib/index.js does not carry the dist entry it was built with')
}

const clientOut = resolve(root, 'lib/client.js')
await build({
  entryPoints: [resolve(root, 'src/client/index.tsx')],
  outfile: clientOut,
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/*'],
  legalComments: 'none',
  logLevel: 'warning',
})
const body = await readFile(clientOut, 'utf8')
if (!/\bapply\b/.test(body) || !/\binject\b/.test(body)) {
  throw new Error('lib/client.js does not expose apply/inject')
}
await writeFile(
  clientOut,
  `window.__ModuleLoader__.load({\n\tid: ${JSON.stringify(packageId)},\n\tfactory: (require) => {\n` +
    `\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;\n` +
    body +
    `\n\t\treturn module.exports;\n\t}\n});\n`,
)
