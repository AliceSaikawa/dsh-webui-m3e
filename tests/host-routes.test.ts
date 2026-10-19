import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { syncBuiltinESMExports } from 'node:module'
import { sep } from 'node:path'
import { test, type TestContext } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import {
  apply, injectUiChoice, prepareM3eIndex, resolveTarget, stripApplicationPreloads, unauthorizedPage,
  type IndexAuthResponse,
} from '../src/host/index.ts'
import { uiChoiceScript } from '../src/shared/ui-choice.ts'

const INDEX_PATHS = [
  '/m3e', '/m3e/', '/m3e/index.html', '/m3e//index.html',
  '/m3e/assets/%2e%2e%2findex.html', '/m3e/%69ndex.html',
  '/m3e/./index.html?ui=m3e', '/m3e/?mock&scenario=approval',
  '/m3e/index.html/', '/m3e/%2findex.html',
]

/** Writes the response Connection owns when `authorizeIndex` refuses a request. */
type DenialWriter = (req: IncomingMessage, res: IndexAuthResponse) => void

/**
 * Connection's own refusal, restated from dsh-client-connection (DSH 0.2.0-rc.2)
 * so a pass-through test compares against DSH's bytes rather than M3E's.
 */
const writeDshUnauthorized: DenialWriter = (req, res) => {
  res.writeHead(401, { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' })
  res.end(req.method === 'HEAD' ? undefined : 'dsh web authentication required; reopen the URL printed by dsh web.\n')
}

function createHostHarness(t: TestContext, authorized: boolean, deny: DenialWriter = writeDshUnauthorized) {
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
  const authorize = t.mock.fn((req: IncomingMessage, res: IndexAuthResponse) => {
    if (authorized) return true
    deny(req, res)
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
    async request(url: string, method = 'GET') {
      const result = { status: 0, headers: {} as Record<string, string>, body: undefined as unknown }
      const req = { method, url } as IncomingMessage
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

test('GET and HEAD index spellings require authorization before reading or rendering HTML', async (t) => {
  const host = createHostHarness(t, false)
  for (const method of ['GET', 'HEAD']) for (const path of INDEX_PATHS) {
    const response = await host.request(path, method)
    assert.equal(response.status, 401, path)
    assert.equal(response.headers['cache-control'], 'no-store', path)
    assert.equal(response.body, method === 'HEAD' ? undefined : unauthorizedPage(), path)
  }
  assert.equal(host.authorize.mock.callCount(), INDEX_PATHS.length * 2)
  assert.equal(host.reads.mock.callCount(), 0)
  assert.equal(host.render.mock.callCount(), 0)
})

test('GET and HEAD authorized index spellings prevent framing and keep no-store rendering', async (t) => {
  const host = createHostHarness(t, true)
  for (const method of ['GET', 'HEAD']) for (const path of INDEX_PATHS) {
    const response = await host.request(path, method)
    assert.equal(response.status, 200, path)
    assert.equal(response.headers['content-type'], 'text/html; charset=utf-8', path)
    assert.equal(response.headers['cache-control'], 'no-store', path)
    assert.equal(response.headers['content-security-policy'], "frame-ancestors 'none'", path)
    assert.equal(response.headers['x-frame-options'], 'DENY', path)
    assert.equal(response.body, '<head><base href="/"><script>boot()</script></head><body>M3E</body>', path)
  }
  assert.equal(host.authorize.mock.callCount(), INDEX_PATHS.length * 2)
  assert.equal(host.render.mock.callCount(), INDEX_PATHS.length * 2)
  assert.equal(host.reads.mock.callCount(), INDEX_PATHS.length * 2)
  for (const call of host.reads.mock.calls) {
    assert.match(String(call.arguments[0]), /[/\\]dist[/\\]index\.html$/)
    assert.equal(call.arguments[1], 'utf8')
  }
})

test('the unauthenticated explanation page carries fixed headers and a CSP without scripts', async (t) => {
  const host = createHostHarness(t, false)
  const response = await host.request('/m3e/')
  assert.equal(response.status, 401)
  assert.equal(response.headers['content-type'], 'text/html; charset=utf-8')
  assert.equal(response.headers['cache-control'], 'no-store')
  assert.equal(response.headers['referrer-policy'], 'no-referrer')
  assert.equal(response.headers['x-frame-options'], 'DENY')
  assert.equal(
    response.headers['content-security-policy'],
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  )
  assert.equal(response.body, unauthorizedPage())
  assert.equal(host.reads.mock.callCount(), 0)
  assert.equal(host.render.mock.callCount(), 0)
})

test('the explanation page stays self-contained, Japanese, and free of request data', () => {
  const page = unauthorizedPage()
  const requestUrl = 'https://phone.example/m3e/index.html?ui=m3e'
  assert.match(page, /<html lang="ja">/)
  assert.match(page, /<meta name="viewport" content="width=device-width, initial-scale=1">/)
  assert.match(page, /color-scheme: light dark/)
  for (const text of [
    'ログインの情報を確かめられませんでした',
    'このページを再読み込みしても直りません。',
    'アドレスバーの URL をタップし、そのままキーボードの「開く」を押してください。',
    '<code>dsh web</code> が表示した URL を開き直してください。',
  ]) assert.ok(page.includes(text), text)
  // A restored Safari tab drops the cookie on every reload the page could start,
  // so the page offers no script and no button that would only fail again.
  assert.doesNotMatch(page, /<script|<button/)
  // No external resource, and nothing carried over from a request.
  assert.doesNotMatch(page, /\s(?:src|href)=/)
  assert.doesNotMatch(page, /@import|url\(/)
  assert.ok(!page.includes(requestUrl))
})

test('a token-bearing 401 and other Connection refusals reach the browser unchanged', async (t) => {
  const stale = createHostHarness(t, false)
  const refused = await stale.request('/m3e/?token=stale')
  assert.equal(refused.status, 401)
  assert.equal(refused.headers['content-type'], 'text/plain; charset=utf-8')
  assert.equal(refused.body, 'dsh web authentication required; reopen the URL printed by dsh web.\n')

  const redirect = createHostHarness(t, false, (_req, res) => {
    res.writeHead(303, {
      'cache-control': 'no-store',
      location: './',
      'referrer-policy': 'no-referrer',
      'set-cookie': 'dsh-example=abc; SameSite=Strict',
    })
    res.end()
  })
  const exchanged = await redirect.request('/m3e/?token=fresh')
  assert.equal(exchanged.status, 303)
  assert.deepEqual(exchanged.headers, {
    'cache-control': 'no-store',
    location: './',
    'referrer-policy': 'no-referrer',
    'set-cookie': 'dsh-example=abc; SameSite=Strict',
  })
  assert.equal(exchanged.body, undefined)

  const forbidden = createHostHarness(t, false, (_req, res) => {
    res.writeHead(403)
    res.end()
  })
  const denied = await forbidden.request('/m3e/')
  assert.equal(denied.status, 403)
  assert.equal(denied.body, undefined)
  assert.equal(forbidden.render.mock.callCount(), 0)
})

test('HEAD index requests receive no body for either refusal', async (t) => {
  const host = createHostHarness(t, false)
  for (const path of ['/m3e/', '/m3e/?token=stale']) {
    const response = await host.request(path, 'HEAD')
    assert.equal(response.status, 401, path)
    assert.equal(response.body, undefined, path)
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

test('DSH 0.2 relative preloads are removed while bootstrap scripts and unrelated preloads survive', () => {
  const bootstrap = '<script src="plugins/??@deepseek-ai/dsh-client-modules/client.js&amp;rev=b"></script>'
  const other = '<link rel="preload" as="script" href="/m3e/assets/own.js">'
  const html = '<head><link rel="preload" as="script" href="plugins/??stock/client.js&amp;rev=a">' + bootstrap + other + '</head>'
  assert.equal(stripApplicationPreloads(html), '<head>' + bootstrap + other + '</head>')
})

test('M3E moves its single base before the injected queue and bootstrap, resolving all Host routes at root', () => {
  const boot = '<script>queue()</script><script src="plugins/??modules/client.js&amp;rev=b"></script>'
  const html = `<head>${boot}<base href="/" /><link rel="manifest" href="/m3e/manifest.webmanifest"></head>`
  const prepared = prepareM3eIndex(html)
  assert.equal(prepared, `<head><base href="/">${boot}<link rel="manifest" href="/m3e/manifest.webmanifest"></head>`)
  assert.equal(prepareM3eIndex(prepared), prepared)
  const base = new URL('/', 'https://host.example/m3e/')
  for (const path of ['plugins/??modules/client.js&rev=b', 'api/session/list', 'api/remote.mux', 'api/session/uploadFileBinary']) {
    assert.equal(new URL(path, base).pathname, '/' + path.split('?')[0])
  }
  // The shared tap remains independent of M3E's base/preload postprocessing.
  const stock = '<head><base href="./"><link rel="preload" as="script" href="plugins/??stock/client.js&amp;rev=a"></head>'
  assert.equal(injectUiChoice(stock), `<head><script>${uiChoiceScript()}</script>${stock.slice(6)}`)
})
