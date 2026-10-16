/**
 * cache-sentinel(DSH の Host プラグイン)との連携。プロンプトキャッシュが切れて入力禁止になったセッションで、
 * 送る前に入力欄の上へ警告と「/unlock」のボタンを出す。cache-sentinel が入っていない DSH では
 * 状態の取得口が 404 になるので何も出さない。
 * 判定の規則は cache-sentinel の docs/spec-ui.md §E2 と同じ(src/client/banner.ts の写し)。
 */
import { useCallback, useEffect, useState } from 'react'

/** 状態の取得口(cache-sentinel の STATUS_PATH)。 */
export const CACHE_SENTINEL_STATUS_PATH = 'api/cache-sentinel.status'
/** 取得の間隔。 */
export const CACHE_SENTINEL_POLL_MS = 30_000
export const CACHE_SENTINEL_UNLOCK_LABEL = '次の 1 回を許可(/unlock)'

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
export function cacheSentinelBanner(status: CacheSentinelStatus | undefined, now: number): CacheSentinelBanner | undefined {
  if (status === undefined || !status.gate) return undefined
  if (status.state === 'stale' && !status.dryRun) {
    const elapsed = status.idleMinutes === null ? '' : `(最終応答から ${status.idleMinutes} 分)`
    return { tone: 'warning', text: `キャッシュ切れ${elapsed}。このまま送ると止められます。`, action: 'unlock' }
  }
  if (status.state === 'unlocked') {
    const rest = status.unlockExpiresAt === null ? '' : `あと ${Math.max(0, Math.ceil((status.unlockExpiresAt - now) / 60_000))} 分`
    return { tone: 'info', text: `次の送信を許可中(キャッシュなしの料金になります)。${rest}` }
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
 */
export function useCacheSentinel(sessionId: string, enabled: boolean) {
  const [status, setStatus] = useState<CacheSentinelStatus>()
  const refresh = useCallback(async () => {
    if (!enabled || sessionId === '') return
    setStatus(await fetchCacheSentinelStatus(sessionId, appBase()))
  }, [enabled, sessionId])

  useEffect(() => {
    setStatus(undefined)
    if (!enabled || sessionId === '') return
    void refresh()
    const timer = setInterval(() => { void refresh() }, CACHE_SENTINEL_POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [enabled, sessionId, refresh])

  return { banner: cacheSentinelBanner(status, Date.now()), refresh }
}
