/** Pack without lifecycle recursion, then inspect the real archive, not dist/. */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { allowedPackPath, parsePackEntries, validatePack } from './pack-contract.ts'

const root = fileURLToPath(new URL('../', import.meta.url))
let tarball = process.argv[2] && resolve(process.argv[2])
if (!tarball) {
  const parent = join(root, 'tmp', 'pack-check')
  mkdirSync(parent, { recursive: true })
  const destination = mkdtempSync(join(parent, 'run-'))
  // npm and pnpm use the same files allowlist. npm --ignore-scripts is only
  // used for this inner inspection; the outer prepack always builds first.
  const packed = execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', destination], {
    cwd: root, encoding: 'utf8', timeout: 120_000,
  })
  const result = JSON.parse(packed) as { filename: string }[]
  if (result.length !== 1 || !result[0]?.filename) throw new Error('npm pack did not produce one tarball')
  tarball = join(destination, result[0].filename)
}
// BSD and GNU tar both start each verbose record with its entry type. Keep
// names from the plain listing: verbose metadata and link-target text vary.
const list = (verbose: boolean) => execFileSync('tar', [verbose ? '-tvzf' : '-tzf', tarball!], {
  encoding: 'utf8', timeout: 30_000,
}).replace(/\n$/, '').split('\n')
const names = list(false)
const types = list(true).map(line => line[0] ?? '')
const parsed = parsePackEntries(names, types)
if (parsed.errors.length) throw new Error(`Invalid release tarball:\n${parsed.errors.join('\n')}`)
const files = parsed.entries.map(({ name, path }) => {
  // Unexpected entries are rejected by name, without reading their contents.
  const readable = allowedPackPath(path) && !/\.(?:png|woff2)$/.test(path)
  return {
    path,
    ...(readable ? { text: execFileSync('tar', ['-xOzf', tarball!, name], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 30_000 }) } : {}),
  }
})
const errors = validatePack(files)
if (errors.length) throw new Error(`Invalid release tarball:\n${errors.join('\n')}`)
console.log(`check:pack OK: ${files.length} files; ${tarball}`)
