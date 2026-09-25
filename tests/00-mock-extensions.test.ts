import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { MOCK_IDS } from '../web/src/dsh/mock/fixtures.ts'

test('拡張の例外を mock.ts の出所とともに表示し、後続拡張と選択シナリオを実行する', (t) => {
  const errors = t.mock.method(console, 'error', () => {})
  const failure = new Error('拡張の登録に失敗しました。')
  const source = '../../features/inbox/mock.ts'
  const ctx = createMockContext({ scenario: 'after-failure', extensions: [
    { source: '../../features/home/mock.ts', extendMock(kit) { kit.addRemote('beforeFailure', { available: true }) } },
    { source, extendMock() { throw failure } },
    { source: '../../features/search/mock.ts', extendMock(kit) {
      kit.addRemote('afterFailure', { available: true })
      kit.scenario('after-failure', () => kit.setSessionState(MOCK_IDS.sessions.readme, { lastAgentError: '後続シナリオを実行しました。' }))
    } },
  ] })
  try {
    assert.equal(errors.mock.callCount(), 1)
    assert.ok(String(errors.mock.calls[0]!.arguments[0]).includes(source))
    assert.equal(errors.mock.calls[0]!.arguments[1], failure)
    assert.deepEqual(ctx.remote.beforeFailure, { available: true })
    assert.deepEqual(ctx.remote.afterFailure, { available: true })
    assert.equal(ctx.sessions.binding(MOCK_IDS.sessions.readme)!.session.getSnapshot().lastAgentError, '後続シナリオを実行しました。')
  } finally { ctx.dispose() }
})

test('出所を省略した既存の拡張も例外の位置を表示し、次の拡張へ進む', (t) => {
  const errors = t.mock.method(console, 'error', () => {})
  const ctx = createMockContext({ extensions: [
    { extendMock() { throw new Error('出所を省略した拡張の失敗') } },
    { extendMock(kit) { kit.addRemote('nextExtension', { available: true }) } },
  ] })
  try {
    assert.equal(errors.mock.callCount(), 1)
    assert.match(String(errors.mock.calls[0]!.arguments[0]), /拡張 1/)
    assert.deepEqual(ctx.remote.nextExtension, { available: true })
  } finally { ctx.dispose() }
})

test('選択したシナリオの実行失敗は拡張登録の失敗として握りつぶさない', (t) => {
  const errors = t.mock.method(console, 'error', () => {})
  const failure = new Error('選択したシナリオの失敗')
  assert.throws(() => createMockContext({ scenario: 'broken-scenario', extensions: [{ extendMock(kit) {
    kit.scenario('broken-scenario', () => { throw failure })
  } }] }), (error) => error === failure)
  assert.equal(errors.mock.callCount(), 0)
})

test('検索は実物と同じ最大 20 件を返し、21 件目があれば hasMore を立てる', async () => {
  const ctx = createMockContext()
  const query = '検索上限の確認用'
  const controller = new AbortController()
  try {
    for (let index = 0; index < 21; index++) {
      ctx.mock.addSession({ id: `search-limit-${index}`, displayTitle: `${query} ${index}`, running: false, blank: true, updatedAt: index }, [])
    }
    const overflow = await ctx.sessions.search(query, controller.signal)
    assert.equal(overflow.ok, true)
    if (!overflow.ok) assert.fail('検索に失敗しました。')
    assert.equal(overflow.value.items.length, 20)
    assert.equal(overflow.value.hasMore, true)
    assert.equal(ctx.sessions.searchResultLimit, 20)
    ctx.mock.removeSession('search-limit-20')
    const exact = await ctx.sessions.search(query, controller.signal)
    assert.equal(exact.ok, true)
    if (!exact.ok) assert.fail('検索に失敗しました。')
    assert.equal(exact.value.items.length, 20)
    assert.equal(exact.value.hasMore, false)
  } finally { ctx.dispose() }
})
