import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { syncBuiltinESMExports } from 'node:module'
import { sep } from 'node:path'
import { test, type TestContext } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import { apply, injectUiChoice, resolveTarget, stripApplicationPreloads } from '../src/host/index.ts'
import { uiChoiceScript } from '../src/shared/ui-choice.ts'

const INDEX_PATHS = ['/m3e', '/m3e/', '/m3e/index.html', '/m3e//index.html', '/m3e/assets/%2e%2e%2findex.html']

function createHostHarness(t: TestContext, authorized: boolean) {
  const html = '<head><link rel="preload" as="script" href="/plugins/stock.js"></head><body>M3E</body>'
  const reads = t.mock.method(fs, 'readFile', async (_path: unknown, encoding?: string) =>
    encoding === 'utf8' ? html : Buffer.from('asset'),
  )
  syncBuiltinESMExports()
  t.after(() => {
    reads.mock.restore()
    syncBuiltinESMExports()
  })

  type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>
  let handler: Handler | undefined
  const authorize = t.mock.fn((_req: IncomingMessage, res: ServerResponse) => {
    if (authorized) return true
    res.writeHead(401, { 'cache-control': 'no-store' })
    res.end('ログインしてください')
    return false
  })
  const render = t.mock.fn((body: string) => body.replace('</head>', '<script>boot()</script></head>'))
  const tap = t.mock.fn()
  const registrations: Array<{ kind: string; path: string }> = []
  apply({
    connection: { authorizeIndex: authorize },
    webServer: {
      register(route: { kind: string; path: string; handler: Handler }) {
        registrations.push({ kind: route.kind, path: route.path })
        handler = route.handler
      },
      renderIndex: render,
      tapIndex: tap,
    },
    effect(callback: () => void) { callback() },
  } as unknown as Context)

  return {
    authorize, reads, render, registrations, tap,
    async request(url: string) {
      const result = { status: 0, headers: {} as Record<string, string>, body: undefined as unknown }
      const req = { method: 'GET', url } as IncomingMessage
      const res = {
        writeHead(status: number, headers: Record<string, string> = {}) {
          result.status = status
          result.headers = headers
        },
        end(body?: unknown) { result.body = body },
      } as unknown as ServerResponse
      assert.ok(handler)
      await handler(req, res)
      return result
    },
  }
}

test('the mount root and its index path serve the entry page', () => {
  for (const path of ['/m3e', '/m3e/', '/m3e/index.html']) assert.equal(resolveTarget(path), 'index')
})

test('normalized index paths use the entry page route', () => {
  for (const path of ['/m3e//index.html', '/m3e/assets/../index.html', '/m3e/./index.html']) {
    assert.equal(resolveTarget(path), 'index', path)
  }
})

test('every index spelling requires authorization before reading or rendering HTML', async (t) => {
  const host = createHostHarness(t, false)
  for (const path of INDEX_PATHS) {
    const response = await host.request(path)
    assert.equal(response.status, 401, path)
    assert.equal(response.headers['cache-control'], 'no-store', path)
    assert.equal(response.body, 'ログインしてください', path)
  }
  assert.equal(host.authorize.mock.callCount(), INDEX_PATHS.length)
  assert.equal(host.reads.mock.callCount(), 0)
  assert.equal(host.render.mock.callCount(), 0)
})

test('every authorized index spelling is rendered with no-store', async (t) => {
  const host = createHostHarness(t, true)
  for (const path of INDEX_PATHS) {
    const response = await host.request(path)
    assert.equal(response.status, 200, path)
    assert.equal(response.headers['content-type'], 'text/html; charset=utf-8', path)
    assert.equal(response.headers['cache-control'], 'no-store', path)
    assert.equal(response.body, '<head><script>boot()</script></head><body>M3E</body>', path)
  }
  assert.equal(host.authorize.mock.callCount(), INDEX_PATHS.length)
  assert.equal(host.render.mock.callCount(), INDEX_PATHS.length)
  assert.equal(host.reads.mock.callCount(), INDEX_PATHS.length)
  for (const call of host.reads.mock.calls) {
    assert.match(String(call.arguments[0]), /[/\\]dist[/\\]index\.html$/)
    assert.equal(call.arguments[1], 'utf8')
  }
})

test('static assets and PWA files keep their cache policy and only the M3E route is registered', async (t) => {
  const host = createHostHarness(t, false)
  for (const [path, type, cache] of [
    ['/m3e/assets/index-abc.js', 'text/javascript; charset=utf-8', 'public, max-age=31536000, immutable'],
    ['/m3e/sw.js', 'text/javascript; charset=utf-8', 'no-cache'],
    ['/m3e/manifest.webmanifest', 'application/manifest+json', 'no-cache'],
  ]) {
    const response = await host.request(path!)
    assert.equal(response.status, 200, path)
    assert.equal(response.headers['content-type'], type, path)
    assert.equal(response.headers['cache-control'], cache, path)
    assert.deepEqual(response.body, Buffer.from('asset'), path)
  }
  assert.equal(host.authorize.mock.callCount(), 0)
  assert.equal(host.render.mock.callCount(), 0)
  assert.deepEqual(host.registrations, [{ kind: 'prefix', path: '/m3e' }])
  assert.equal(host.tap.mock.callCount(), 1)
  assert.equal(host.tap.mock.calls[0]!.arguments[0], injectUiChoice)
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
