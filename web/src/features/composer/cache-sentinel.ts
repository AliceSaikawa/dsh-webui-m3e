/**
 * cache-sentinel(DSH の Host プラグイン)との連携。プロンプトキャッシュが切れて入力禁止になったセッションで、
 * 送る前に入力欄の上へ警告と「/unlock」のボタンを出す。cache-sentinel が入っていない DSH では
 * 状態の取得口が 404 になるので何も出さない。
 * 判定の規則は cache-sentinel の docs/spec-ui.md §E2 と同じ(src/client/banner.ts の写し)。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { messagesOf } from '../../i18n/catalog.ts'
import { useMessages } from '../../i18n/index.ts'
import { composerMessages, type ComposerMessages } from './messages.ts'

/** 状態の取得口(cache-sentinel の STATUS_PATH)。 */
export const CACHE_SENTINEL_STATUS_PATH = 'api/cache-sentinel.status'
/** 取得の間隔。 */
export const CACHE_SENTINEL_POLL_MS = 30_000
/** The source-language label. Components use the catalog so it follows the page language. */
export const CACHE_SENTINEL_UNLOCK_LABEL = composerMessages.ja.cacheUnlockLabel

export interface CacheSentinelStatus {
  gate: boolean
  state: string
  idleMinutes: number | null
  unlockExpiresAt: number | null
  dryRun: boolean
}

export type CacheSentinelBanner =
  | { tone: 'warning'; text: string; action: 'unlock' }
  | { tone: 'info'; text: string }

const finiteOrNull = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isFinite(value))

/** 応答を検査して必要な項目だけを取り出す。形が違えば undefined。 */
export function parseCacheSentinelStatus(value: unknown): CacheSentinelStatus | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const { gate, state, idleMinutes, unlockExpiresAt, dryRun } = record
  if (typeof gate !== 'boolean' || typeof state !== 'string' || typeof dryRun !== 'boolean') return undefined
  if (!finiteOrNull(idleMinutes) || !finiteOrNull(unlockExpiresAt)) return undefined
  return { gate, state, idleMinutes, unlockExpiresAt, dryRun }
}

/** 表示する内容。何も出さないときは undefined。 */
export function cacheSentinelBanner(status: CacheSentinelStatus | undefined, now: number,
  text: ComposerMessages = messagesOf(composerMessages, 'ja')): CacheSentinelBanner | undefined {
  if (status === undefined || !status.gate) return undefined
  if (status.state === 'stale' && !status.dryRun) {
    return { tone: 'warning', text: status.idleMinutes === null ? text.cacheStale : text.cacheStaleWithAge(status.idleMinutes), action: 'unlock' }
  }
  if (status.state === 'unlocked') {
    return { tone: 'info', text: status.unlockExpiresAt === null ? text.cacheUnlocked : text.cacheUnlockedRemaining(Math.max(0, Math.ceil((status.unlockExpiresAt - now) / 60_000))) }
  }
  return undefined
}

/**
 * 取得口の URL。M3E は `/m3e/` に置かれ、DSH の `/api` はその 1 つ上にある。
 * @param appBase - M3E の基準 URL(例: `https://host/m3e/`)。
 */
export function cacheSentinelStatusUrl(appBase: string, sessionId: string): string {
  const url = new URL(`../${CACHE_SENTINEL_STATUS_PATH}`, appBase)
  url.searchParams.set('sessionId', sessionId)
  return url.href
}

/** 状態を 1 回取得する。失敗(404 を含む)は undefined。 */
export async function fetchCacheSentinelStatus(
  sessionId: string,
  appBase: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CacheSentinelStatus | undefined> {
  try {
    const response = await fetchImpl(cacheSentinelStatusUrl(appBase, sessionId), { credentials: 'same-origin', cache: 'no-store' })
    if (!response.ok) return undefined
    return parseCacheSentinelStatus(await response.json())
  } catch {
    return undefined
  }
}

function appBase(): string {
  return new URL(import.meta.env.BASE_URL, location.origin).href
}

/**
 * 表示中のセッションの状態を、表示開始時・30 秒ごと・画面が前面に戻ったときに取り直す。
 * `enabled` が偽(新しい会話の入力欄・偽データの画面)のときは取得しない。
 * 取得は重なることがあるので、最後に始めた取得の結果だけを表示に使う。
 */
export function useCacheSentinel(sessionId: string, enabled: boolean) {
  const text = useMessages(composerMessages)
  const [status, setStatus] = useState<CacheSentinelStatus>()
  // 取得ごとに進める番号。セッションの切り替え・無効化・画面を閉じたときも進め、終わる前の応答を捨てる。
  const latest = useRef(0)
  const refresh = useCallback(async () => {
    if (!enabled || sessionId === '') return
    const ticket = ++latest.current
    const next = await fetchCacheSentinelStatus(sessionId, appBase())
    if (ticket === latest.current) setStatus(next)
  }, [enabled, sessionId])

  useEffect(() => {
    setStatus(undefined)
    if (!enabled || sessionId === '') return
    void refresh()
    const timer = setInterval(() => { void refresh() }, CACHE_SENTINEL_POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { latest.current++; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [enabled, sessionId, refresh])

  return { banner: cacheSentinelBanner(status, Date.now(), text), refresh }
}
