import type { MockKit } from '../../dsh/mock/kit.ts'
import type { ISessions, JsonValue, SessionSummary, SessionWireEvent } from '../../dsh/services.ts'
import { sharedSessions } from '../../dsh/mock/fixtures.ts'
import { findMatchRanges, normalizeQuery, selectRecentSessions } from './search-utils.ts'

const origin = Date.parse('2026-09-25T09:00:00+09:00')
const fixtures = [
  ['search-permissions', '操作の権限を見直す', '読み取り操作と書き込み操作の承認を分ける手順を確認しました。'],
  ['search-mobile', 'スマートフォンの操作確認', '画面が狭いときも承認の理由を読めるようにします。承認後は会話へ戻ります。'],
  ['search-history', '履歴の表示を整える', '昨日の会話を表示してスクロール位置を確かめます。'],
  ['search-colors', '画面の配色を確認する', '明るい外観と暗い外観のどちらでも文字が読めます。'],
] as const

function textOf(value: JsonValue): string {
  if (!value || typeof value !== 'object') return ''
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join('\n')
  const object = value as { readonly [key: string]: JsonValue }
  if ((object.type === 'text' || object.type === 'reasoning') && typeof object.text === 'string') return object.text
  return Object.values(object).map(textOf).filter(Boolean).join('\n')
}

/** Twenty Unicode characters either side of the first literal match. */
export function excerptOf(text: string, query: string): string | undefined {
  const range = findMatchRanges(text, query)[0]
  if (!range) return undefined
  const before = Array.from(text.slice(0, range.start))
  const after = Array.from(text.slice(range.end))
  return `${before.length > 20 ? '…' : ''}${before.slice(-20).join('')}${text.slice(range.start, range.end)}${after.slice(0, 20).join('')}${after.length > 20 ? '…' : ''}`
}

function waitForSearch(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('検索を取り消しました。', 'AbortError')); return }
    const abort = () => { clearTimeout(timer); reject(new DOMException('検索を取り消しました。', 'AbortError')) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 400)
    signal.addEventListener('abort', abort, { once: true })
  })
}

export function extendMock(kit: MockKit): void {
  const initialRecords = new Map(sharedSessions.map(row => [row.summary.id, row.records]))
  function add(id: string, title: string, text: string, offset: number) {
    const summary: SessionSummary = { id, title, displayTitle: title, cwd: '/mock/dsh-webui-m3e', running: false, blank: false, updatedAt: origin - offset }
    const records: SessionWireEvent[] = [{ type: 'user/message', seq: 0, time: summary.updatedAt, data: { id: `${id}-message`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] }, surfaceOp: 'append' }]
    initialRecords.set(id, records)
    kit.addSession(summary, records)
  }
  fixtures.forEach(([id, title, text], index) => add(id, title, text, (index + 1) * 60_000))
  let fail = false
  // Match the installed host's fixed bound; no pagination or writable limit API.
  kit.patch('sessions.searchResultLimit', 20)
  kit.patch('sessions.search', async function (this: ISessions, input: string, signal: AbortSignal) {
    await waitForSearch(signal)
    if (signal.aborted) throw new DOMException('検索を取り消しました。', 'AbortError')
    if (fail) return { ok: false, error: { code: 'search/unavailable', message: '検索サービスに接続できません。', details: {} } }
    const query = normalizeQuery(input)
    const list = this.list.getSnapshot()
    const rows = selectRecentSessions(list.ids.flatMap(id => list.byId[id] ? [list.byId[id]!] : []), list.ids.length)
    const items = query ? rows.flatMap(row => {
      const records = new Map((initialRecords.get(row.id) ?? []).map(event => [event.seq, event]))
      for (const entry of this.binding(row.id)?.eventSource.getSnapshot().entries ?? []) {
        if (entry.type === 'event') records.set(entry.event.seq, entry.event)
      }
      const body = [...records.values()].sort((a, b) => a.seq - b.seq).map(event => textOf(event.data)).filter(Boolean).join('\n')
      const snippet = excerptOf(body, query) ?? excerptOf(row.displayTitle, query)
      return snippet === undefined ? [] : [{ sessionId: row.id, snippet }]
    }) : []
    return { ok: true, value: { items: items.slice(0, this.searchResultLimit), hasMore: items.length > this.searchResultLimit } }
  })
  kit.scenario('search-error', () => { fail = true })
  kit.scenario('search-more', () => {
    for (let index = 1; index <= 24; index++) add(`search-example-${index}`, `検索の確認 ${index}`, `検索の追加結果を確認するための記録 ${index} です。`, index * 1000)
  })
}
