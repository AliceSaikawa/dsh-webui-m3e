import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ISessions } from '../web/src/dsh/services.ts'
import {
  createSearchController,
  isSearchBusy,
  searchControllerFor,
} from '../web/src/features/search/search-controller.ts'

type SearchResponse = Awaited<ReturnType<ISessions['search']>>
type SearchCall = {
  query: string
  signal: AbortSignal
  resolve: (value: SearchResponse) => void
  reject: (reason: unknown) => void
}

/** Deliberately ignores aborts so races must be handled by the controller. */
function controlledSearch() {
  const calls: SearchCall[] = []
  const sessions: Pick<ISessions, 'search'> = {
    search(query, signal) {
      return new Promise<SearchResponse>((resolve, reject) => {
        calls.push({ query, signal, resolve, reject })
      })
    },
  }
  return { calls, sessions }
}

function result(sessionId: string, hasMore = false): SearchResponse {
  return { ok: true, value: { items: [{ sessionId, snippet: `${sessionId} の内容` }], hasMore } }
}

const timeout: SearchResponse = {
  ok: false,
  error: { code: 'rpc/timeout', message: 'Request timed out', details: {} },
}

test('search waits 300 ms after the latest input and sends a trimmed query', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { sessions, calls } = controlledSearch()
  const controller = createSearchController(sessions)
  controller.setInput('承')
  t.mock.timers.tick(299)
  assert.equal(calls.length, 0)
  controller.setInput(' 承認 ')
  t.mock.timers.tick(299)
  assert.equal(calls.length, 0)
  assert.equal(controller.getSnapshot().phase, 'waiting')
  t.mock.timers.tick(1)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.query, '承認')
  assert.equal(controller.getSnapshot().phase, 'loading')
})

for (const staleResponse of ['success', 'failure', 'rejection'] as const) {
  test(`new input aborts immediately and stale ${staleResponse} cannot replace the latest result`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const { sessions, calls } = controlledSearch()
    const controller = createSearchController(sessions)
    controller.setInput('以前')
    t.mock.timers.tick(300)
    controller.setInput('最新')
    assert.equal(calls[0]!.signal.aborted, true)
    assert.equal(calls.length, 1)
    t.mock.timers.tick(300)
    calls[1]!.resolve(result('最新', true))
    await Promise.resolve()
    const latest = controller.getSnapshot()
    assert.equal(latest.phase, 'ready')
    assert.equal(latest.hasMore, true)

    if (staleResponse === 'rejection') calls[0]!.reject(new Error('古い検索の失敗'))
    else calls[0]!.resolve(staleResponse === 'success' ? result('以前') : timeout)
    await Promise.resolve()
    assert.equal(controller.getSnapshot(), latest)
    assert.deepEqual(controller.getSnapshot().items, [{ sessionId: '最新', snippet: '最新 の内容' }])
    assert.equal(controller.getSnapshot().error, null)
  })
}

test('blank input cancels both waiting and active searches and discards delayed results', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { sessions, calls } = controlledSearch()
  const controller = createSearchController(sessions)
  controller.setInput('待機中')
  t.mock.timers.tick(100)
  controller.setInput(' \n　')
  t.mock.timers.tick(1000)
  assert.equal(calls.length, 0)

  controller.setInput('実行中')
  t.mock.timers.tick(300)
  controller.setScrollTop(100)
  controller.setInput('')
  assert.equal(calls[0]!.signal.aborted, true)
  assert.deepEqual(controller.getSnapshot(), {
    input: '', query: '', phase: 'idle', composing: false, items: [], hasMore: false, error: null, retryable: false,
  })
  assert.equal(controller.getScrollTop(), 0)
  calls[0]!.resolve(result('実行中'))
  await Promise.resolve()
  assert.equal(controller.getSnapshot().phase, 'idle')
  assert.deepEqual(controller.getSnapshot().items, [])
})

test('spacing changes preserve the debounce deadline, active request and completed results', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { sessions, calls } = controlledSearch()
  const controller = createSearchController(sessions)
  controller.setInput('承認')
  t.mock.timers.tick(200)
  controller.setInput(' 承認 ')
  t.mock.timers.tick(100)
  assert.equal(calls.length, 1)
  controller.setInput('承認 ')
  assert.equal(calls[0]!.signal.aborted, false)
  calls[0]!.resolve(result('承認'))
  await Promise.resolve()
  controller.setScrollTop(76)
  controller.setInput('承認')
  t.mock.timers.tick(1000)
  assert.equal(calls.length, 1)
  assert.equal(controller.getSnapshot().phase, 'ready')
  assert.equal(controller.getSnapshot().items[0]!.sessionId, '承認')
  assert.equal(controller.getScrollTop(), 76)
})

test('IME composition aborts the old request and waits for composition to end', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { sessions, calls } = controlledSearch()
  const controller = createSearchController(sessions)
  controller.setInput('前の語')
  t.mock.timers.tick(300)
  controller.setInput('しょう', true)
  assert.equal(calls[0]!.signal.aborted, true)
  assert.equal(controller.getSnapshot().phase, 'composing')
  assert.equal(isSearchBusy(controller.getSnapshot()), false)
  t.mock.timers.tick(1000)
  controller.setInput('承認', true)
  t.mock.timers.tick(1000)
  assert.equal(calls.length, 1)
  assert.equal(isSearchBusy(controller.getSnapshot()), false)
  controller.setInput('承認', false)
  assert.equal(isSearchBusy(controller.getSnapshot()), true)
  t.mock.timers.tick(299)
  assert.equal(calls.length, 1)
  t.mock.timers.tick(1)
  assert.equal(calls.length, 2)
  assert.equal(calls[1]!.query, '承認')
})

test('failed results show a Japanese reason and retry searches the same query', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { sessions, calls } = controlledSearch()
  const controller = createSearchController(sessions)
  controller.setInput('承認')
  t.mock.timers.tick(300)
  calls[0]!.resolve(timeout)
  await Promise.resolve()
  assert.equal(controller.getSnapshot().phase, 'error')
  assert.equal(controller.getSnapshot().error, '応答を待ちきれませんでした。もう一度お試しください。')
  assert.equal(controller.getSnapshot().retryable, true)
  controller.retry()
  assert.equal(controller.getSnapshot().phase, 'waiting')
  assert.equal(controller.getSnapshot().error, null)
  t.mock.timers.tick(299)
  assert.equal(calls.length, 1)
  t.mock.timers.tick(1)
  assert.equal(calls[1]!.query, '承認')
  calls[1]!.resolve({ ok: true, value: { items: [], hasMore: false } })
  await Promise.resolve()
  assert.equal(controller.getSnapshot().phase, 'ready')
  assert.deepEqual(controller.getSnapshot().items, [])
})

test('thrown failures show Japanese fallback text and a blank query cannot be retried', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { sessions, calls } = controlledSearch()
  const controller = createSearchController(sessions)
  controller.setInput('承認')
  t.mock.timers.tick(300)
  calls[0]!.reject(new Error('Unexpected failure'))
  await Promise.resolve()
  assert.equal(controller.getSnapshot().phase, 'error')
  assert.equal(controller.getSnapshot().error, '検索サービスから結果を取得できませんでした。時間をおいて、もう一度お試しください。')
  controller.setInput('　')
  controller.retry()
  t.mock.timers.tick(1000)
  assert.equal(calls.length, 1)
  assert.equal(controller.getSnapshot().phase, 'idle')
})

test('suspend and resume preserve completed input, results and scroll without searching again', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { sessions, calls } = controlledSearch()
  const controller = createSearchController(sessions)
  controller.setInput(' 承認 ')
  t.mock.timers.tick(300)
  calls[0]!.resolve(result('承認', true))
  await Promise.resolve()
  controller.setScrollTop(241)
  const before = controller.getSnapshot()
  controller.suspend()
  t.mock.timers.tick(1000)
  controller.resume()
  t.mock.timers.tick(1000)
  assert.equal(calls.length, 1)
  assert.equal(controller.getSnapshot(), before)
  assert.equal(controller.getSnapshot().input, ' 承認 ')
  assert.equal(controller.getScrollTop(), 241)
})

test('suspending the debounce cancels its timer and resuming schedules exactly one search', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { sessions, calls } = controlledSearch()
  const controller = createSearchController(sessions)
  controller.setInput('承認')
  t.mock.timers.tick(200)
  controller.suspend()
  t.mock.timers.tick(1000)
  assert.equal(calls.length, 0)
  controller.resume()
  controller.resume()
  t.mock.timers.tick(299)
  assert.equal(calls.length, 0)
  t.mock.timers.tick(1)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.query, '承認')
})

test('suspending active search aborts it and resume ignores the previous response', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { sessions, calls } = controlledSearch()
  const controller = createSearchController(sessions)
  controller.setInput('承認')
  t.mock.timers.tick(300)
  controller.suspend()
  assert.equal(calls[0]!.signal.aborted, true)
  assert.equal(controller.getSnapshot().phase, 'waiting')
  controller.resume()
  calls[0]!.resolve(result('以前'))
  await Promise.resolve()
  assert.equal(controller.getSnapshot().phase, 'waiting')
  assert.deepEqual(controller.getSnapshot().items, [])
  t.mock.timers.tick(300)
  assert.equal(calls.length, 2)
  calls[1]!.resolve(result('再開'))
  await Promise.resolve()
  assert.equal(controller.getSnapshot().items[0]!.sessionId, '再開')
})

test('controller cache restores the same sessions connection and isolates other connections', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const first = controlledSearch()
  const second = controlledSearch()
  const firstSessions = first.sessions as ISessions
  const secondSessions = second.sessions as ISessions
  const firstController = searchControllerFor(firstSessions)
  firstController.setInput('承認')
  firstController.setScrollTop(120)
  assert.equal(searchControllerFor(firstSessions), firstController)
  assert.equal(searchControllerFor(firstSessions).getSnapshot().input, '承認')
  assert.equal(searchControllerFor(firstSessions).getScrollTop(), 120)
  const secondController = searchControllerFor(secondSessions)
  assert.notEqual(secondController, firstController)
  assert.equal(secondController.getSnapshot().input, '')
  assert.equal(secondController.getScrollTop(), 0)
  secondController.setInput('別の接続')
  t.mock.timers.tick(300)
  assert.equal(first.calls[0]!.query, '承認')
  assert.equal(second.calls[0]!.query, '別の接続')
})

test('starting and ending IME with unchanged text retains results, scroll and does not search', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { sessions, calls } = controlledSearch()
  const controller = createSearchController(sessions)
  controller.setInput('承認')
  t.mock.timers.tick(300)
  calls[0]!.resolve(result('結果', true))
  await Promise.resolve()
  controller.setScrollTop(240)
  const items = controller.getSnapshot().items
  controller.setInput('承認', true)
  assert.equal(controller.getSnapshot().composing, true)
  assert.equal(controller.getSnapshot().items, items)
  assert.equal(controller.getSnapshot().hasMore, true)
  assert.equal(controller.getScrollTop(), 240)
  assert.equal(isSearchBusy(controller.getSnapshot()), false)
  t.mock.timers.tick(60_000)
  assert.equal(calls.length, 1)
  controller.setInput('承認', false)
  t.mock.timers.tick(300)
  assert.equal(calls.length, 1)
  assert.equal(controller.getSnapshot().items, items)
})

test('unchanged IME preserves an active request and accepts its result during composition', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { sessions, calls } = controlledSearch()
  const controller = createSearchController(sessions)
  controller.setInput('承認')
  t.mock.timers.tick(300)
  controller.setInput('承認', true)
  assert.equal(calls[0]!.signal.aborted, false)
  assert.equal(isSearchBusy(controller.getSnapshot()), false)
  calls[0]!.resolve(result('結果'))
  await Promise.resolve()
  assert.equal(controller.getSnapshot().phase, 'ready')
  assert.equal(controller.getSnapshot().items[0]?.sessionId, '結果')
  assert.equal(controller.getSnapshot().composing, true)
  controller.setInput('承認', false)
  t.mock.timers.tick(300)
  assert.equal(calls.length, 1)
})

test('unchanged composition preserves the scheduled search, but actual editing cancels it', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { sessions, calls } = controlledSearch()
  const controller = createSearchController(sessions)
  controller.setInput('承認')
  t.mock.timers.tick(100)
  controller.setInput('承認', true)
  t.mock.timers.tick(200)
  assert.equal(calls.length, 1)
  assert.equal(isSearchBusy(controller.getSnapshot()), false)
  controller.setInput('承認の', true)
  assert.equal(calls[0]!.signal.aborted, true)
  t.mock.timers.tick(60_000)
  assert.equal(calls.length, 1)
  assert.equal(controller.getSnapshot().phase, 'composing')
  assert.equal(isSearchBusy(controller.getSnapshot()), false)
})

test('unfinished composition is not submitted by navigating away and back', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { sessions, calls } = controlledSearch()
  const controller = createSearchController(sessions)
  controller.setInput('しょうにん', true)
  controller.suspend()
  controller.resume()
  t.mock.timers.tick(60_000)
  assert.equal(calls.length, 0)
  assert.equal(isSearchBusy(controller.getSnapshot()), false)
  controller.setInput('承認', false)
  t.mock.timers.tick(300)
  assert.equal(calls.length, 1)
})

test('host length limit is checked before sending, including trimmed text and emoji', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { sessions, calls } = controlledSearch()
  const controller = createSearchController(sessions)
  controller.setInput(` ${'語'.repeat(500)} `)
  t.mock.timers.tick(300)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.query.length, 500)
  controller.setInput('語'.repeat(501))
  assert.equal(calls[0]!.signal.aborted, true)
  assert.equal(controller.getSnapshot().phase, 'error')
  assert.match(controller.getSnapshot().error!, /500文字以内/)
  assert.equal(controller.getSnapshot().retryable, false)
  controller.retry()
  t.mock.timers.tick(300)
  assert.equal(calls.length, 1)
  controller.setInput('🔎'.repeat(251))
  t.mock.timers.tick(300)
  assert.equal(calls.length, 1)
  controller.setInput('🔎'.repeat(250))
  t.mock.timers.tick(300)
  assert.equal(calls.length, 2)
  assert.equal(controller.getSnapshot().error, null)
})

test('NUL is rejected locally, and overlong IME text is validated only on confirmation', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { sessions, calls } = controlledSearch()
  const controller = createSearchController(sessions)
  controller.setInput('承\0認')
  assert.match(controller.getSnapshot().error!, /使えない文字/)
  controller.retry()
  t.mock.timers.tick(300)
  assert.equal(calls.length, 0)
  controller.setInput('語'.repeat(501), true)
  t.mock.timers.tick(60_000)
  assert.equal(controller.getSnapshot().error, null)
  assert.equal(isSearchBusy(controller.getSnapshot()), false)
  controller.setInput('語'.repeat(501), false)
  assert.match(controller.getSnapshot().error!, /500文字以内/)
  assert.equal(calls.length, 0)
})

for (const code of ['gateway/bad-request', 'gateway/internal']) {
  for (const thrown of [false, true]) {
    test(`${code} (${thrown ? 'thrown' : 'result'}) explains the required action and retries only recoverable failures`, async t => {
      t.mock.timers.enable({ apis: ['setTimeout'] })
      const { sessions, calls } = controlledSearch()
      const controller = createSearchController(sessions)
      controller.setInput('承認')
      t.mock.timers.tick(300)
      const failure = { code, message: 'Host detail', details: {} }
      if (thrown) calls[0]!.reject({ rpcError: failure })
      else calls[0]!.resolve({ ok: false, error: failure })
      await Promise.resolve()
      const state = controller.getSnapshot()
      assert.equal(state.phase, 'error')
      assert.match(state.error!, code === 'gateway/bad-request' ? /文字数や貼り付けた内容/ : /設定や動作状態/)
      assert.doesNotMatch(state.error!, /時間をおいて|Host detail/)
      assert.equal(state.retryable, code === 'gateway/internal')
      controller.retry()
      t.mock.timers.tick(300)
      assert.equal(calls.length, code === 'gateway/internal' ? 2 : 1)
      if (code === 'gateway/internal') {
        calls[1]!.resolve(result('復旧後の結果'))
        await Promise.resolve()
        assert.equal(controller.getSnapshot().phase, 'ready')
      }
      controller.setInput('承認の記録')
      t.mock.timers.tick(300)
      assert.equal(calls.length, code === 'gateway/internal' ? 3 : 2)
    })
  }
}
