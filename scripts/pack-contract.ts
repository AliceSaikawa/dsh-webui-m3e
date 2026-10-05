/** Pure validation of the files actually present in a release tarball. */
export interface PackFile { path: string; text?: string }

const required = [
  'package.json', 'lib/index.js', 'lib/client.js', 'dist/index.html',
  'cordis.patch.yml', 'LICENSE', 'README.md', 'README.en.md', 'README.zh-CN.md',
]
const staticFiles = new Set([...required,
  'dist/manifest.webmanifest', 'dist/sw.js', 'dist/sw-cache.js',
  'dist/apple-touch-icon.png', 'dist/icon-192.png', 'dist/icon-512.png', 'dist/icon-maskable-512.png',
])
export function allowedPackPath(path: string): boolean {
  // Vite's explicit [name]-[hash:8] output in vite.config.ts. No source-style dots.
  return staticFiles.has(path) || /^dist\/assets\/[\w-]+-[\w-]{8}\.(?:js|css|woff2)$/.test(path)
}

/** Validate raw tar names before removing the npm package root or reading content. */
export function parsePackEntries(names: readonly string[]): { entries: { name: string; path: string }[]; errors: string[] } {
  const entries: { name: string; path: string }[] = []
  const errors: string[] = []
  for (const name of names) {
    if (!name.startsWith('package/')) { errors.push(`invalid archive root: ${name}`); continue }
    if (!name.endsWith('/')) entries.push({ name, path: name.slice('package/'.length) })
  }
  return { entries, errors }
}

// Stable fixture IDs and test hooks, traced to main.tsx's DEV-only import,
// dsh/mock/index.ts, fixtures.ts and context.ts. The production error message
// mentioning ?mock is intentionally allowed; that text is not mock code.
const mockMarkers = ['readme-review', 'approval-sheet', '__m3eTest', 'createMockContext', 'mock/open-failed', '/mock/']
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

export function validatePack(files: readonly PackFile[]): string[] {
  const errors: string[] = []
  const byPath = new Map(files.map(file => [file.path, file]))
  for (const path of required) if (!byPath.has(path)) errors.push(`missing: ${path}`)
  for (const extension of ['js', 'css']) {
    if (!files.some(file => file.path.startsWith('dist/assets/') && file.path.endsWith(`.${extension}`))) errors.push(`missing: dist/assets/*.${extension}`)
  }
  for (const file of files) {
    if (!allowedPackPath(file.path)) errors.push(`unexpected: ${file.path}`)
    if (file.text !== undefined) {
      if (/(?<![\w./-])(?:\/Users\/|\/home\/)|file:\/\/\/(?:Users|home)\/|[A-Za-z]:[\\/]+Users[\\/]+/i.test(file.text)) errors.push(`absolute home path: ${file.path}`)
      if (/\.(?:js|css)$/.test(file.path) && /sourceMappingURL\s*=/.test(file.text)) errors.push(`source map reference: ${file.path}`)
      if (file.path.endsWith('.js') && mockMarkers.some(marker => file.text!.includes(marker))) errors.push(`mock code: ${file.path}`)
    }
  }
  if (byPath.size !== files.length) errors.push('duplicate archive entries')
  let manifest: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(byPath.get('package.json')?.text ?? '')
    if (!object(parsed)) throw new Error('not an object')
    manifest = parsed
  } catch { errors.push('invalid package.json'); return errors }

  if (manifest.private === true) errors.push('private package')
  const patchNames = [...(byPath.get('cordis.patch.yml')?.text ?? '').matchAll(/^[ \t]+name:[ \t]*([\w@/.-]+)[ \t]*$/gm)].map(match => match[1])
  if (typeof manifest.name !== 'string' || patchNames.length !== 1 || patchNames[0] !== manifest.name) errors.push('package/patch name mismatch')
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    if (manifest[field] !== undefined && (!object(manifest[field]) || Object.keys(manifest[field]).length !== 0)) errors.push(`runtime dependencies: ${field}`)
  }
  const scripts = object(manifest.scripts) ? manifest.scripts : {}
  for (const name of ['preinstall', 'install', 'postinstall', 'prepare']) if (name in scripts) errors.push(`consumer lifecycle: ${name}`)
  const target = (value: unknown, label: string) => {
    if (typeof value !== 'string' || !byPath.has(value.replace(/^\.\//, ''))) errors.push(`missing target: ${label}`)
  }
  target(manifest.main, 'main')
  const visitExport = (value: unknown, label: string): void => {
    if (object(value) && Object.keys(value).length > 0) for (const [key, next] of Object.entries(value)) visitExport(next, `${label}.${key}`)
    else target(value, label)
  }
  visitExport(manifest.exports, 'exports')
  const dsh = object(manifest.dsh) ? manifest.dsh : {}
  const bundle = object(dsh.bundle) ? dsh.bundle : {}
  if (bundle.patch !== './cordis.patch.yml') errors.push('missing bundle patch declaration')
  return errors
}
