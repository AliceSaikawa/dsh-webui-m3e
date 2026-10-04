import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pageHref, resolveRoute, shouldReplace, type RouteDef } from '../web/src/app/route-match.ts'

const routes: RouteDef[] = ['/', '/s/:id', '/s/:id/trace', '/s/:id/file', '/settings/:page', '/new'].map(path => ({ path, render: () => null }))
test('matches exact routes, decodes IDs and keeps query params separate from the pattern', () => {
  const result = resolveRoute('#/s/%E6%97%A5%E6%9C%AC/file?path=src%2Fmain.ts&id=wrong', routes)
  assert.equal(result.path, '/s/:id/file')
  assert.deepEqual(result.params, { path: 'src/main.ts', id: '日本' })
  assert.equal(resolveRoute('#/new?ws=a+b', routes).params.ws, 'a b')
  assert.equal(resolveRoute('', routes).path, '/')
})
test('rejects missing IDs, bad encoding and unmatched extra segments', () => {
  for (const path of ['#/s/', '#/s/a/unknown', '#/s/%E0%A4%A']) assert.equal(resolveRoute(path, routes).path, null)
})
test('tab replacements never add a history step, deeper navigation does', () => {
  assert.equal(shouldReplace('#/', '/settings'), true)
  assert.equal(shouldReplace('/s/a', '#/s/a/trace'), true)
  assert.equal(shouldReplace('/s/a/trace', '/s/a'), true)
  assert.equal(shouldReplace('/s/a', '/s/b'), false)
  assert.equal(shouldReplace('/settings', '/settings/model'), false)
})

test('UI hashes keep the M3E pathname and mock query independently of a root document base', () => {
  for (const path of ['/m3e/', '/m3e/index.html']) {
    const page = `https://host.example${path}?mock&scenario=approval#/`
    assert.equal(pageHref('#/s/a%2Fb?tab=chat', page), `https://host.example${path}?mock&scenario=approval#/s/a%2Fb?tab=chat`)
    assert.equal(pageHref('#/settings', page), `https://host.example${path}?mock&scenario=approval#/settings`)
  }
})

test('Markdown fragment and relative links keep page-based destinations; absolute links stay absolute', () => {
  const page = 'https://host.example/m3e/?mock#/s/a'
  assert.equal(pageHref('#section', page), 'https://host.example/m3e/?mock#section')
  assert.equal(pageHref('readme.md', page), 'https://host.example/m3e/readme.md')
  assert.equal(pageHref('/?ui=classic', page), 'https://host.example/?ui=classic')
  assert.equal(pageHref('https://example.org/doc#section', page), 'https://example.org/doc#section')
  assert.equal(pageHref('https://', page), 'https://')
})
