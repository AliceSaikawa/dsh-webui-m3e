import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSync } from 'esbuild'
import { createRequire } from 'node:module'

// React と import.meta.env を含むモジュールを Node で読むため、esbuild で CJS にしてから評価する。
const bundled = buildSync({
  entryPoints: ['web/src/features/composer/cache-sentinel.ts'],
  bundle: true, platform: 'node', format: 'cjs', write: false,
  define: { 'import.meta.env.BASE_URL': '"/m3e/"' },
}).outputFiles[0]!.text
interface Status { gate: boolean; state: string; idleMinutes: number | null; unlockExpiresAt: number | null; dryRun: boolean }
interface Loaded {
  cacheSentinelBanner(status: Status | undefined, now: number): unknown
  cacheSentinelStatusUrl(appBase: string, sessionId: string): string
  fetchCacheSentinelStatus(sessionId: string, appBase: string, fetchImpl: typeof fetch): Promise<Status | undefined>
  parseCacheSentinelStatus(value: unknown): Status | undefined
  CACHE_SENTINEL_UNLOCK_LABEL: string
}
const loaded = { exports: {} as Loaded }
new Function('module', 'exports', 'require', bundled)(loaded, loaded.exports, createRequire(import.meta.url))
const { cacheSentinelBanner, cacheSentinelStatusUrl, fetchCacheSentinelStatus, parseCacheSentinelStatus, CACHE_SENTINEL_UNLOCK_LABEL } = loaded.exports

const stale = { gate: true, state: 'stale', idleMinutes: 75, unlockExpiresAt: null, dryRun: false }

test('cache-sentinel: 失効したセッションでは警告と /unlock のボタンを出す', () => {
  assert.deepEqual(cacheSentinelBanner(stale, 0), { tone: 'warning', text: 'キャッシュ切れ(最終応答から 75 分)。このまま送ると止められます。', action: 'unlock' })
  assert.deepEqual(cacheSentinelBanner({ ...stale, idleMinutes: null }, 0), { tone: 'warning', text: 'キャッシュ切れ。このまま送ると止められます。', action: 'unlock' })
  assert.equal(CACHE_SENTINEL_UNLOCK_LABEL, '次の 1 回を許可(/unlock)')
})

test('cache-sentinel: 許可中は残り分数を切り上げて出す', () => {
  const unlocked = { ...stale, state: 'unlocked', unlockExpiresAt: 10 * 60_000 }
  assert.deepEqual(cacheSentinelBanner(unlocked, 60_001), { tone: 'info', text: '次の送信を許可中(キャッシュなしの料金になります)。あと 9 分' })
  assert.deepEqual(cacheSentinelBanner(unlocked, 20 * 60_000), { tone: 'info', text: '次の送信を許可中(キャッシュなしの料金になります)。あと 0 分' })
  assert.deepEqual(cacheSentinelBanner({ ...unlocked, unlockExpiresAt: null }, 0), { tone: 'info', text: '次の送信を許可中(キャッシュなしの料金になります)。' })
})

test('cache-sentinel: 入力禁止でない・dryRun・失効していないときは何も出さない', () => {
  assert.equal(cacheSentinelBanner(undefined, 0), undefined)
  assert.equal(cacheSentinelBanner({ ...stale, gate: false }, 0), undefined)
  assert.equal(cacheSentinelBanner({ ...stale, dryRun: true }, 0), undefined)
  for (const state of ['fresh', 'no-response', 'unknown', 'inactive']) assert.equal(cacheSentinelBanner({ ...stale, state }, 0), undefined)
})

test('cache-sentinel: 応答の形を検査し、必要な項目だけを取り出す', () => {
  assert.deepEqual(parseCacheSentinelStatus({ ...stale, mode: 'block', thresholdMinutes: 60 }), stale)
  for (const bad of [null, 'x', { ...stale, gate: 'yes' }, { ...stale, idleMinutes: Number.NaN }, { ...stale, unlockExpiresAt: '1' }, { ...stale, dryRun: undefined }]) {
    assert.equal(parseCacheSentinelStatus(bad), undefined)
  }
})

test('cache-sentinel: 取得口は M3E の置き場所の 1 つ上の /api を指す', () => {
  assert.equal(cacheSentinelStatusUrl('https://host.example/m3e/', 'session-a b'), 'https://host.example/api/cache-sentinel.status?sessionId=session-a+b')
})

test('cache-sentinel: 取得の失敗(cache-sentinel の無い DSH の 404 を含む)では何も出さない', async () => {
  const calls: unknown[][] = []
  const ok = (async (...args: unknown[]) => { calls.push(args); return new Response(JSON.stringify(stale)) }) as typeof fetch
  assert.deepEqual(await fetchCacheSentinelStatus('s1', 'https://h/m3e/', ok), stale)
  assert.deepEqual(calls[0], ['https://h/api/cache-sentinel.status?sessionId=s1', { credentials: 'same-origin', cache: 'no-store' }])
  assert.equal(await fetchCacheSentinelStatus('s1', 'https://h/m3e/', (async () => new Response('not found', { status: 404 })) as typeof fetch), undefined)
  assert.equal(await fetchCacheSentinelStatus('s1', 'https://h/m3e/', (async () => { throw new Error('offline') }) as typeof fetch), undefined)
  assert.equal(await fetchCacheSentinelStatus('s1', 'https://h/m3e/', (async () => new Response('{x')) as typeof fetch), undefined)
})
