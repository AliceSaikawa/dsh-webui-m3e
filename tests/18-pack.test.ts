import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePackEntries, validatePack, type PackFile } from '../scripts/pack-contract.ts'
import { productionModuleErrors } from '../scripts/production-modules.ts'

const assetJs = 'dist/assets/index-AbCd1234.js'
const assetCss = 'dist/assets/index-2YhsQp64.css'

function fixture(): PackFile[] {
  return [
    { path: 'package.json', text: JSON.stringify({ name: 'dsh-webui-m3e', main: 'lib/index.js', exports: { '.': { default: './lib/index.js' }, './client': './lib/client.js' }, dsh: { bundle: { patch: './cordis.patch.yml' } }, scripts: { prepack: 'build-and-check' } }) },
    { path: 'cordis.patch.yml', text: '- insert:\n    - id: webui-m3e\n      name: dsh-webui-m3e\n' },
    ...['lib/index.js', 'lib/client.js', 'dist/index.html', assetJs, assetCss, 'dist/assets/material-symbols-outlined-DzyP15l8.woff2', 'LICENSE', 'README.md', 'README.en.md', 'README.zh-CN.md',
      'dist/manifest.webmanifest', 'dist/sw.js', 'dist/sw-cache.js', 'dist/apple-touch-icon.png', 'dist/icon-192.png', 'dist/icon-512.png', 'dist/icon-maskable-512.png',
    ].map(path => ({ path, text: 'release content' })),
  ]
}
function metadata(change: (manifest: any) => void): PackFile[] {
  const files = fixture()
  const manifest = JSON.parse(files[0]!.text!)
  change(manifest)
  files[0]!.text = JSON.stringify(manifest)
  return files
}
const content = (path: string, text: string) => fixture().map(file => file.path === path ? { ...file, text } : file)
const rejects = (files: PackFile[], message: string) => assert.ok(validatePack(files).includes(message), message)

test('pack: accepts release artifacts and producer-only prepack', () => {
  assert.deepEqual(validatePack(fixture()), [])
  assert.deepEqual(validatePack(metadata(manifest => { manifest.dependencies = {} })), [])
  assert.deepEqual(validatePack(content(assetJs, 'const routes = { "../features/home/routes.tsx": 1 }; // ?mock is a production help message')), [])
})
test('pack: requires every entrypoint and document', () => {
  for (const path of ['package.json', 'lib/index.js', 'lib/client.js', 'dist/index.html', 'cordis.patch.yml', 'LICENSE', 'README.md', 'README.en.md', 'README.zh-CN.md']) {
    rejects(fixture().filter(file => file.path !== path), `missing: ${path}`)
  }
})
test('pack: requires JS and CSS assets', () => {
  for (const extension of ['js', 'css']) rejects(fixture().filter(file => !file.path.startsWith('dist/assets/') || !file.path.endsWith(`.${extension}`)), `missing: dist/assets/*.${extension}`)
})
test('pack: rejects development files, settings, maps and traversal', () => {
  for (const path of ['vite.config.ts', 'src/host/index.ts', 'web/index.html', 'tests/a.test.ts', 'e2e/a.ts', 'e2e-dsh/a.ts', 'docs/x.md', 'tmp/a.txt', 'node_modules/x/index.js', 'dist/settings.json', 'dist/assets/app.js.map', 'dist/assets/../a.js', '../package.json']) {
    rejects([...fixture(), { path }], `unexpected: ${path}`)
  }
})
test('pack: rejects source map references', () => {
  for (const path of [assetJs, assetCss]) for (const gap of ['', ' ', '\t', ' \t ']) {
    rejects(content(path, `/*# sourceMappingURL${gap}=app.map */`), `source map reference: ${path}`)
  }
})
test('pack: rejects mock code', () => {
  for (const marker of ['readme-review', 'approval-sheet', '__m3eTestModelCatalogGate', 'createMockContext', 'mock/open-failed', '/mock/workspace']) {
    rejects(content(assetJs, marker), `mock code: ${assetJs}`)
  }
})
test('pack: rejects absolute user paths', () => {
  for (const path of ['lib/index.js', 'README.md']) for (const text of ['/Users/example/project', '/home/example/project', 'C:\\Users\\example\\project', 'C:\\\\Users\\\\example\\\\project']) {
    rejects(content(path, text), `absolute home path: ${path}`)
  }
})
test('pack: rejects duplicate entries', () => {
  rejects([...fixture(), fixture()[2]!], 'duplicate archive entries')
})
test('pack: rejects invalid manifests', () => {
  for (const text of ['{', 'null', '[]', '"name"']) rejects(content('package.json', text), 'invalid package.json')
})
test('pack: rejects private packages', () => {
  rejects(metadata(manifest => { manifest.private = true }), 'private package')
})
test('pack: requires matching package and patch names', () => {
  rejects(metadata(manifest => { manifest.name = 'different' }), 'package/patch name mismatch')
  rejects(content('cordis.patch.yml', '[]'), 'package/patch name mismatch')
  rejects(content('cordis.patch.yml', '- name: dsh-webui-m3e\n  name: different\n'), 'package/patch name mismatch')
})
test('pack: rejects runtime dependencies', () => {
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) for (const value of [{ build: '1.0.0' }, null, []]) {
    rejects(metadata(manifest => { manifest[field] = value }), `runtime dependencies: ${field}`)
  }
})
test('pack: rejects consumer lifecycle scripts', () => {
  for (const script of ['preinstall', 'install', 'postinstall', 'prepare']) rejects(metadata(manifest => { manifest.scripts[script] = 'build' }), `consumer lifecycle: ${script}`)
})
test('pack: requires the main target', () => {
  rejects(metadata(manifest => { manifest.main = 'missing.js' }), 'missing target: main')
  rejects(metadata(manifest => { delete manifest.main }), 'missing target: main')
})
test('pack: requires every export target', () => {
  rejects(metadata(manifest => { manifest.exports['.'].default = './missing.js' }), 'missing target: exports...default')
  rejects(metadata(manifest => { manifest.exports['./client'] = './missing.js' }), 'missing target: exports../client')
  rejects(metadata(manifest => { delete manifest.exports }), 'missing target: exports')
  rejects(metadata(manifest => { manifest.exports = {} }), 'missing target: exports')
})
test('pack: requires the bundle patch declaration', () => {
  rejects(metadata(manifest => { delete manifest.dsh }), 'missing bundle patch declaration')
  rejects(metadata(manifest => { manifest.dsh.bundle.patch = './wrong.yml' }), 'missing bundle patch declaration')
})

test('pack: rejects development asset names without a build hash', () => {
  for (const path of ['dist/assets/example.test.js', 'dist/assets/vite.config.js', 'dist/assets/example.TEST.js', 'dist/assets/index.js', 'dist/assets/index-short.js', 'dist/assets/example.test-AbCd1234.js']) {
    rejects([...fixture(), { path }], `unexpected: ${path}`)
  }
})
test('pack: rejects nested assets and unexpected extensions', () => {
  for (const path of ['dist/assets/nested/extra.js', 'dist/assets/nested/extra-AbCd1234.js', 'dist/assets/note.txt', 'dist/assets/note-AbCd1234.txt', 'dist/assets/index-AbCd1234.JS', 'dist/assets/index-AbCd1234.CSS', 'dist/assets/font-AbCd1234.WOFF2', 'dist/assets/index-AbCd1234.js.map', 'dist/assets/index-AbCd1234.map']) {
    rejects([...fixture(), { path }], `unexpected: ${path}`)
  }
})
test('pack: rejects asset hashes of seven, nine and ten characters', () => {
  for (const hash of ['AbCd123', 'AbCd12345', 'AbCd123456']) for (const extension of ['js', 'css', 'woff2']) {
    const path = `dist/assets/index-${hash}.${extension}`
    rejects([...fixture(), { path }], `unexpected: ${path}`)
  }
})
test('pack: rejects file URLs to user homes', () => {
  for (const text of ['file:///Users/example/project', 'file:///home/example/project']) rejects(content(assetJs, text), `absolute home path: ${assetJs}`)
})
test('pack: rejects Windows user paths regardless of case', () => {
  for (const text of ['C:\\users\\example', 'c:/USERS/example', 'C:\\\\users\\\\example']) rejects(content(assetJs, text), `absolute home path: ${assetJs}`)
})
test('pack: rejects two patch names even when the first matches', () => {
  for (const next of ['dsh-webui-m3e', 'different']) rejects(content('cordis.patch.yml', `- insert:\n    - name: ignored-inline\n      name: dsh-webui-m3e\n      name: ${next}\n`), 'package/patch name mismatch')
})
test('pack: rejects an unindented patch name', () => {
  for (const text of ['name: dsh-webui-m3e\n', '\nname: dsh-webui-m3e\n']) rejects(content('cordis.patch.yml', text), 'package/patch name mismatch')
})
test('pack: rejects a newline between the patch name key and value', () => {
  for (const gap of ['\n', '\r\n', ' \n', '\t\n']) {
    rejects(content('cordis.patch.yml', `- insert:\n    - id: webui-m3e\n      name:${gap}dsh-webui-m3e\n`), 'package/patch name mismatch')
  }
})
test('pack: accepts npm archive entries and directory records', () => {
  const names = ['package/', 'package/lib/', ...fixture().map(file => `package/${file.path}`)]
  assert.deepEqual(parsePackEntries(names), { entries: fixture().map(file => ({ name: `package/${file.path}`, path: file.path })), errors: [] })
})
test('pack: rejects raw entries outside the npm package root', () => {
  for (const name of ['lib/index.js', 'dist/assets/index-AbCd1234.js', 'outside/', './package/lib/index.js', '/package/lib/index.js']) {
    assert.deepEqual(parsePackEntries([name]), { entries: [], errors: [`invalid archive root: ${name}`] })
  }
  const names = fixture().map(file => file.path === 'lib/index.js' ? file.path : `package/${file.path}`)
  const parsed = parsePackEntries(names)
  assert.deepEqual(parsed.errors, ['invalid archive root: lib/index.js'])
  assert.ok(validatePack(parsed.entries).includes('missing: lib/index.js'))
})

// Inventory of the current mock files (observable.ts is the sole shared utility).
const mockModules = [
  ...['kit', 'session-validation', 'index', 'fork', 'questions', 'jobs', 'context', 'images', 'record', 'search', 'fixtures'].map(name => `web/src/dsh/mock/${name}.ts`),
  ...['pwa/mock', 'search/mock', 'trace/trace-fixtures', 'trace/mock', 'interactions/mock', 'home/directory-mock', 'home/mock',
    'settings/mock-mutations', 'settings/mock-fixtures', 'settings/mock-models', 'settings/mock-validation', 'settings/mock', 'chat/mock',
    'session-tools/mock-goals', 'session-tools/mock-files', 'session-tools/mock', 'inbox/mock', 'composer/mock-permission-catalog', 'composer/mock',
  ].map(name => `web/src/features/${name}.ts`),
]
test('pack: rejects every current mock module in production chunks', () => {
  for (const path of mockModules) for (const id of [path, `/project/${path}?v=1`, `C:\\project\\${path.replaceAll('/', '\\')}`]) {
    assert.deepEqual(productionModuleErrors([id]), [`mock module in production: ${id}`])
  }
})
test('pack: allows production modules and the shared observable only', () => {
  assert.deepEqual(productionModuleErrors([
    '/project/web/src/main.tsx', '/project/web/src/dsh/completion-status.ts', '/project/web/src/dsh/conversation-selection.ts',
    '/project/web/src/features/settings/store.ts', '/project/node_modules/example/mock.ts',
    'web/src/dsh/mock/observable.ts', '/project/web/src/dsh/mock/observable.ts?v=1', 'C:\\project\\web\\src\\dsh\\mock\\observable.ts',
  ]), [])
  assert.deepEqual(productionModuleErrors(['web/src/dsh/mock/observable-extra.ts']), ['mock module in production: web/src/dsh/mock/observable-extra.ts'])
})
