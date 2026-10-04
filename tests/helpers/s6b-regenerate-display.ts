/** Run from repository root: node tests/helpers/s6b-regenerate-display.ts
 * Read-only baseline source: git show 722692c:web/src/... . No checkout needed.
 * captureDisplay owns the fixed event and date-label clocks documented in its test.
 */
import { registerHooks, stripTypeScriptTypes } from 'node:module'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'

const root = fileURLToPath(new URL('../../', import.meta.url))
registerHooks({ load(url, context, next) {
  const path = url.startsWith('file:') ? fileURLToPath(url) : ''
  if (!path.startsWith(root + 'web/src/') || !path.endsWith('.ts')) return next(url, context)
  const source = execFileSync('git', ['show', '722692c:' + path.slice(root.length)], { encoding: 'utf8', timeout: 10_000 })
  return { format: 'module', shortCircuit: true, source: stripTypeScriptTypes(source) }
} })
const { captureDisplay } = await import('./s6b-display.ts')
writeFileSync(new URL('../fixtures/s6b-display-722692c.json', import.meta.url), JSON.stringify(await captureDisplay(), null, 2) + '\n')
