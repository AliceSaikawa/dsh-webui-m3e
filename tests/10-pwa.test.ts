import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import { build } from 'esbuild'

type CacheStore = {
  keys(): Promise<string[]>
  delete(name: string): Promise<boolean>
  open(name: string): Promise<{
    match(request: Request): Promise<Response | undefined>
    put(request: Request, response: Response): Promise<void>
  }>
}
const policy = await import(new URL('../web/public/sw-cache.js', import.meta.url).href) as {
  CACHE_NAME: string
  CACHE_PREFIX: string
  isCacheableRequest(request: Request, origin: string): boolean
  isCacheableResponse(request: Request, response: Response): boolean
  removeOldCaches(storage: CacheStore): Promise<void>
  cacheFirst(request: Request, storage: CacheStore, fetcher: (request: Request) => Promise<Response>): Promise<Response>
}
const origin = 'https://pwa.example'
const asset = '/m3e/assets/index-Ab12_cd3.js'
const publicFile = (name: string) => new URL(`../web/public/${name}`, import.meta.url)
const request = (path: string, options?: RequestInit) => new Request(new URL(path, origin), options)
const javascript = (body = 'export {}') => new Response(body, { headers: { 'content-type': 'text/javascript; charset=utf-8' } })

function memoryStorage() {
  const entries = new Map<string, Response>()
  const names = new Set([policy.CACHE_NAME, `${policy.CACHE_PREFIX}v0`, 'standard-ui-cache', 'another-app'])
  const writes: string[] = []
  const deleted: string[] = []
  const storage: CacheStore = {
    keys: async () => [...names],
    delete: async (name) => { deleted.push(name); return names.delete(name) },
    open: async (name) => {
      assert.equal(name, policy.CACHE_NAME)
      return {
        match: async (value) => entries.get(value.url)?.clone(),
        put: async (value, response) => { writes.push(value.url); entries.set(value.url, response) },
      }
    },
  }
  return { storage, entries, writes, deleted }
}

test('PWA manifest stays in /m3e/ and references the required PNG sizes', async () => {
  const manifest = JSON.parse(await readFile(publicFile('manifest.webmanifest'), 'utf8'))
  assert.equal(manifest.name, 'DSH')
  assert.equal(manifest.short_name, 'DSH')
  assert.equal(manifest.lang, 'ja')
  assert.equal(manifest.id, '/m3e/')
  assert.equal(manifest.start_url, '/m3e/')
  assert.equal(manifest.scope, '/m3e/')
  assert.equal(manifest.display, 'standalone')
  assert.equal(manifest.background_color, '#fffbff')
  assert.equal(manifest.theme_color, manifest.background_color)
  assert.deepEqual(manifest.icons.map((icon: { sizes: string; purpose: string }) => [icon.sizes, icon.purpose]), [
    ['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable'],
  ])
  const icons = [...manifest.icons, { src: '/m3e/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }]
  for (const icon of icons) {
    assert.equal(icon.type, 'image/png')
    assert.ok(icon.src.startsWith('/m3e/'))
    const png = await readFile(publicFile(icon.src.slice('/m3e/'.length)))
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    assert.equal(png.subarray(12, 16).toString(), 'IHDR')
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes)
  }
})

test('the head supplies Apple metadata and keeps the app entry and body intact', async () => {
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8')
  assert.match(html, /<link rel="manifest" href="\/m3e\/manifest.webmanifest"/)
  assert.match(html, /<link rel="apple-touch-icon" href="\/m3e\/apple-touch-icon.png"/)
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/)
  assert.match(html, /name="apple-mobile-web-app-title" content="DSH"/)
  assert.match(html, /name="apple-mobile-web-app-status-bar-style" content="default"/)
  assert.match(html, /name="theme-color" content="#fffbff" media="\(prefers-color-scheme: light\)"/)
  assert.match(html, /name="theme-color" content="#1c1b1e" media="\(prefers-color-scheme: dark\)"/)
  assert.match(html, /<script type="module" src="\.\/src\/main.tsx"><\/script>/)
  assert.equal(html.match(/<body>[\s\S]*<\/body>/)?.[0], '<body>\n    <div id="app"></div>\n  </body>')
})

test('registration runs only in production with /m3e/ scope and handles failure', async () => {
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8')
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
  assert.ok(script)
  for (const [replacement, supported, shouldRegister] of [
    ['false', true, false], ['%PROD%', true, false], ['true', false, false], ['true', true, true],
  ] as const) {
    const callbacks: Array<() => void> = []
    const calls: unknown[][] = []
    const warnings: string[] = []
    runInNewContext(script.replace('%PROD%', replacement), {
      navigator: supported ? { serviceWorker: { register: (...args: unknown[]) => {
        calls.push(args)
        return Promise.reject(new Error('registration unavailable'))
      } } } : {},
      window: { addEventListener: (name: string, callback: () => void, options: { once: boolean }) => {
        assert.equal(name, 'load')
        assert.equal(options.once, true)
        callbacks.push(callback)
      } },
      console: { warn: (message: string) => warnings.push(message) },
    })
    assert.equal(callbacks.length, shouldRegister ? 1 : 0)
    callbacks.forEach((callback) => callback())
    await Promise.resolve()
    assert.equal(calls.length, shouldRegister ? 1 : 0)
    if (shouldRegister) {
      assert.equal(calls[0]?.[0], '/m3e/sw.js')
      assert.equal(JSON.stringify(calls[0]?.[1]), JSON.stringify({ scope: '/m3e/', type: 'module', updateViaCache: 'none' }))
      assert.equal(warnings.length, 1)
    }
  }
})

test('cache selection allows hashed static assets and local fonts only', () => {
  for (const path of [asset, '/m3e/assets/nested/theme-12345678.css', '/m3e/assets/picture-Abcd1234.webp',
    '/m3e/assets/material-symbols.woff2', '/m3e/fonts/text.woff2', '/m3e/fonts/text.ttf']) {
    assert.equal(policy.isCacheableRequest(request(path), origin), true, path)
  }
  for (const path of ['/m3e', '/m3e/', '/m3e/?mock', '/m3e/index.html', '/m3e/index.html?ui=classic',
    '/', '/index.html', '/assets/index-Ab12_cd3.js', '/m3e/sw.js', '/m3e/sw-cache.js',
    '/m3e/manifest.webmanifest', '/m3e/apple-touch-icon.png', '/m3e/assets/index.js',
    '/m3e/assets/index-Ab12_cd3.html', '/m3e/assets/data-Ab12_cd3.json', '/m3e/fonts/login.html',
    '/m3e/rpc', '/m3e/socket', '/m3e-other/assets/index-Ab12_cd3.js', `${asset}?refresh=1`,
    '/M3E/assets/index-Ab12_cd3.js', '/m3e/ASSETS/index-Ab12_cd3.js',
    'https://elsewhere.example/m3e/assets/index-Ab12_cd3.js', 'wss://pwa.example/m3e/socket']) {
    assert.equal(policy.isCacheableRequest(request(path), origin), false, path)
  }
  assert.equal(policy.isCacheableRequest(request(asset, { method: 'POST' }), origin), false)
  assert.equal(policy.isCacheableRequest(request(asset, { method: 'HEAD' }), origin), false)
  assert.equal(policy.isCacheableRequest(request(asset, { headers: { Range: 'bytes=0-10' } }), origin), false)
  for (const override of [{ mode: 'navigate' }, { destination: 'document' }, { destination: 'iframe' }]) {
    const value = request(asset)
    for (const [key, data] of Object.entries(override)) Object.defineProperty(value, key, { value: data })
    assert.equal(policy.isCacheableRequest(value, origin), false)
  }
})

test('styles, images and fonts require their own content types', () => {
  for (const [path, type] of [
    ['/m3e/assets/theme-12345678.css', 'text/css'],
    ['/m3e/assets/picture-Abcd1234.svg', 'image/svg+xml'],
    ['/m3e/fonts/symbols.woff2', 'font/woff2'],
    ['/m3e/fonts/text.ttf', 'application/octet-stream'],
  ]) {
    assert.equal(policy.isCacheableResponse(request(path!), new Response('static', { headers: { 'content-type': type! } })), true)
    assert.equal(policy.isCacheableResponse(request(path!), new Response('<html>', { headers: { 'content-type': 'text/html' } })), false)
  }
})

test('cache misses are stored, cache hits avoid the network, and only our old caches are removed', async () => {
  const state = memoryStorage()
  let fetched = 0
  const fetcher = async () => { fetched++; return javascript('static content') }
  assert.equal(await (await policy.cacheFirst(request(asset), state.storage, fetcher)).text(), 'static content')
  assert.equal(await (await policy.cacheFirst(request(asset), state.storage, fetcher)).text(), 'static content')
  assert.equal(fetched, 1)
  assert.equal(state.writes.length, 1)
  await policy.removeOldCaches(state.storage)
  assert.deepEqual(state.deleted, [`${policy.CACHE_PREFIX}v0`])
  assert.deepEqual(await state.storage.keys(), [policy.CACHE_NAME, 'standard-ui-cache', 'another-app'])
})

test('HTML, login failures, redirects and uncacheable responses are never saved as assets', async () => {
  const redirected = javascript()
  Object.defineProperty(redirected, 'redirected', { value: true })
  for (const response of [
    new Response('<html>entry</html>', { headers: { 'content-type': 'text/html' } }),
    new Response('login', { status: 401 }), new Response('missing', { status: 404 }),
    new Response('partial', { status: 206, headers: { 'content-type': 'text/javascript' } }),
    Response.redirect(`${origin}/`), redirected,
    new Response('no cache', { headers: { 'content-type': 'text/javascript', 'cache-control': 'no-store' } }),
    new Response('private', { headers: { 'content-type': 'text/javascript', 'cache-control': 'private' } }),
    new Response('varies', { headers: { 'content-type': 'text/javascript', vary: '*' } }),
    new Response('wrong type', { headers: { 'content-type': 'image/png' } }),
  ]) {
    const state = memoryStorage()
    assert.equal(await policy.cacheFirst(request(asset), state.storage, async () => response), response)
    assert.equal(state.writes.length, 0)
  }
  const state = memoryStorage()
  state.entries.set(request(asset).url, new Response('<html>old page</html>', { headers: { 'content-type': 'text/html' } }))
  assert.equal(await (await policy.cacheFirst(request(asset), state.storage, async () => javascript('fresh'))).text(), 'fresh')
})

test('storage failures preserve network access, while an offline miss has no index fallback', async () => {
  for (const stage of ['open', 'match', 'put']) {
    const broken: CacheStore = { ...memoryStorage().storage, open: async () => {
      if (stage === 'open') throw new Error('storage unavailable')
      return {
        match: async () => { if (stage === 'match') throw new Error('read failed'); return undefined },
        put: async () => { throw new Error('quota exceeded') },
      }
    } }
    assert.equal(await (await policy.cacheFirst(request(asset), broken, async () => javascript('online'))).text(), 'online')
  }
  await assert.rejects(policy.cacheFirst(request(asset), memoryStorage().storage, async () => {
    throw new Error('offline')
  }), /offline/)
})

test('worker lifecycle claims immediately and fetch ignores all entry and standard UI requests', async () => {
  const output = await build({ entryPoints: [fileURLToPath(publicFile('sw.js'))], bundle: true, write: false, format: 'iife' })
  type WorkerEvent = { request?: Request; waitUntil?: (promise: Promise<unknown>) => void; respondWith?: (promise: Promise<Response>) => void }
  const listeners = new Map<string, (event: WorkerEvent) => void>()
  const state = memoryStorage()
  let skipped = 0
  let claimed = 0
  let fetched = 0
  runInNewContext(output.outputFiles[0]!.text, {
    URL,
    self: {
      location: { origin },
      addEventListener: (name: string, callback: (event: WorkerEvent) => void) => listeners.set(name, callback),
      skipWaiting: async () => { skipped++ },
      clients: { claim: async () => { claimed++ } },
    },
    caches: state.storage,
    fetch: async () => { fetched++; return javascript() },
  })
  for (const name of ['install', 'activate']) {
    let lifetime: Promise<unknown> | undefined
    assert.ok(listeners.has(name))
    listeners.get(name)!({ waitUntil: (promise) => { lifetime = promise } })
    assert.ok(lifetime)
    await lifetime
  }
  assert.equal(skipped, 1)
  assert.equal(claimed, 1)
  assert.deepEqual(state.deleted, [`${policy.CACHE_PREFIX}v0`])
  const handle = listeners.get('fetch')!
  for (const path of ['/m3e/', '/m3e/index.html', '/m3e/?mock', '/', '/m3e/sw.js', '/m3e/rpc', '/plugins/stock.js']) {
    handle({ request: request(path), respondWith: () => assert.fail(`unexpected interception: ${path}`) })
  }
  assert.equal(fetched, 0)
  let response: Promise<Response> | undefined
  handle({ request: request(asset), respondWith: (promise) => { response = promise } })
  assert.ok(response)
  assert.equal((await response).status, 200)
  assert.equal(fetched, 1)
})
