import assert from 'node:assert/strict'
import { sep } from 'node:path'
import { test } from 'node:test'
import { injectUiChoice, resolveTarget, stripApplicationPreloads } from '../src/host/index.ts'
import { uiChoiceScript } from '../src/shared/ui-choice.ts'

test('the mount root and its index path serve the entry page', () => {
  for (const path of ['/m3e', '/m3e/', '/m3e/index.html']) assert.equal(resolveTarget(path), 'index')
})

test('asset paths resolve inside dist', () => {
  const target = resolveTarget('/m3e/assets/index-abc.js')
  assert.ok(typeof target === 'string' && target.endsWith(`${sep}dist${sep}assets${sep}index-abc.js`))
})

test('paths escaping dist are refused', () => {
  assert.equal(resolveTarget('/m3e/../package.json'), undefined)
  assert.equal(resolveTarget('/m3e/../../etc/passwd'), undefined)
})

test('application combo preloads are removed and everything else is kept', () => {
  const html =
    '<head><link rel="preload" as="script" href="/plugins/??a/client.js,b/client.js&amp;rev=1">' +
    '<script src="/plugins/??@deepseek-ai/dsh-client-modules/client.js&amp;rev=2"></script>' +
    '<link rel="modulepreload" href="/m3e/assets/x.js"></head>'
  assert.equal(
    stripApplicationPreloads(html),
    '<head><script src="/plugins/??@deepseek-ai/dsh-client-modules/client.js&amp;rev=2"></script>' +
      '<link rel="modulepreload" href="/m3e/assets/x.js"></head>',
  )
})

test('the UI choice script is the first thing in the head, ahead of the stock bundle', () => {
  const html = '<!doctype html><html><head lang="x"><script src="/plugins/boot.js"></script></head></html>'
  assert.equal(
    injectUiChoice(html),
    `<!doctype html><html><head lang="x"><script>${uiChoiceScript()}</script><script src="/plugins/boot.js"></script></head></html>`,
  )
})
