import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validatePack, type PackFile } from '../scripts/pack-contract.ts'

function fixture(): PackFile[] {
  return [
    { path: 'package.json', text: JSON.stringify({ name: 'dsh-webui-m3e', main: 'lib/index.js', exports: { '.': { default: './lib/index.js' }, './client': './lib/client.js' }, dsh: { bundle: { patch: './cordis.patch.yml' } }, scripts: { prepack: 'build-and-check' } }) },
    { path: 'cordis.patch.yml', text: '- insert:\n    - id: webui-m3e\n      name: dsh-webui-m3e\n' },
    ...['lib/index.js', 'lib/client.js', 'dist/index.html', 'dist/assets/app.js', 'dist/assets/app.css', 'dist/assets/font.woff2', 'LICENSE', 'README.md', 'README.en.md', 'README.zh-CN.md'].map(path => ({ path, text: 'release content' })),
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
  assert.deepEqual(validatePack(content('dist/assets/app.js', 'const routes = { "../features/home/routes.tsx": 1 }; // ?mock is a production help message')), [])
})
test('pack: requires every entrypoint and document', () => {
  for (const path of ['package.json', 'lib/index.js', 'lib/client.js', 'dist/index.html', 'cordis.patch.yml', 'LICENSE', 'README.md', 'README.en.md', 'README.zh-CN.md']) {
    rejects(fixture().filter(file => file.path !== path), `missing: ${path}`)
  }
})
test('pack: requires JS and CSS assets', () => {
  for (const extension of ['js', 'css']) rejects(fixture().filter(file => file.path !== `dist/assets/app.${extension}`), `missing: dist/assets/*.${extension}`)
})
test('pack: rejects development files, settings, maps and traversal', () => {
  for (const path of ['vite.config.ts', 'src/host/index.ts', 'web/index.html', 'tests/a.test.ts', 'e2e/a.ts', 'e2e-dsh/a.ts', 'docs/x.md', 'tmp/a.txt', 'node_modules/x/index.js', 'dist/settings.json', 'dist/assets/app.js.map', 'dist/assets/../a.js', '../package.json']) {
    rejects([...fixture(), { path }], `unexpected: ${path}`)
  }
})
test('pack: rejects source map references', () => {
  for (const path of ['dist/assets/app.js', 'dist/assets/app.css']) rejects(content(path, '//# sourceMappingURL=app.map'), `source map reference: ${path}`)
})
test('pack: rejects mock code', () => {
  for (const marker of ['readme-review', 'approval-sheet', '__m3eTestModelCatalogGate', 'createMockContext', 'mock/open-failed', '/mock/workspace']) {
    rejects(content('dist/assets/app.js', marker), 'mock code: dist/assets/app.js')
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
