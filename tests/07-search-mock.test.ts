import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { extendMock, excerptOf } from '../web/src/features/search/mock.ts'
import { selectRecentSessions } from '../web/src/features/search/search-utils.ts'

test('抜粋は一致した語の前後20文字を保ち、絵文字を途中で切らない', () => {
  assert.equal(excerptOf(`${'🔎'.repeat(25)}承認${'後'.repeat(25)}`, '承認'), `…${'🔎'.repeat(20)}承認${'後'.repeat(20)}…`)
  assert.equal(excerptOf('前 READme 後', 'readme'), '前 READme 後')
  assert.equal(excerptOf('本文', 'なし'), undefined)
  assert.equal(excerptOf('本文', '  '), undefined)
})

test('偽検索は400ms待ち、承認3件・zzz0件・題名と本文を検索する', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  try {
    let settled = false
    const pending = ctx.sessions.search('承認', new AbortController().signal).then(result => { settled = true; return result })
    t.mock.timers.tick(399)
    await Promise.resolve()
    assert.equal(settled, false)
    t.mock.timers.tick(1)
    const result = await pending
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.value.items.length, 3)
    assert.equal(result.value.hasMore, false)
    assert.ok(result.value.items.every(item => item.snippet.includes('承認')))
    assert.ok(result.value.items.some(item => item.sessionId === 'search-permissions'))
    for (const [query, expected] of [['zzz', 0], ['配色', 1], ['書き込み操作', 1], ['  ', 0]] as const) {
      const next = ctx.sessions.search(query, new AbortController().signal)
      t.mock.timers.tick(400)
      const found = await next
      assert.equal(found.ok, true)
      if (found.ok) assert.equal(found.value.items.length, expected, query)
    }
    const list = ctx.sessions.list.getSnapshot()
    assert.equal(selectRecentSessions(Object.values(list.byId)).length, 5)
  } finally { ctx.dispose() }
})

test('偽検索は中断時に結果を返さず、開始前の中断も処理する', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  try {
    const abort = new AbortController()
    const pending = ctx.sessions.search('承認', abort.signal)
    const rejected = assert.rejects(pending, { name: 'AbortError' })
    t.mock.timers.tick(200)
    abort.abort()
    await rejected
    t.mock.timers.tick(400)
    await assert.rejects(ctx.sessions.search('承認', abort.signal), { name: 'AbortError' })
  } finally { ctx.dispose() }
})

test('search-error は400ms後に理由付きの失敗を返す', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const ctx = createMockContext({ scenario: 'search-error', extensions: [{ extendMock }] })
  try {
    const pending = ctx.sessions.search('承認', new AbortController().signal)
    t.mock.timers.tick(400)
    const result = await pending
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.error.code, 'search/unavailable')
      assert.match(result.error.message, /接続できません/)
    }
  } finally { ctx.dispose() }
})

test('search-more は固定上限20件と hasMore を返し、絞り込みで余りがなくなる', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const ctx = createMockContext({ scenario: 'search-more', extensions: [{ extendMock }] })
  try {
    assert.equal(ctx.sessions.searchResultLimit, 20)
    const pending = ctx.sessions.search('検索', new AbortController().signal)
    t.mock.timers.tick(400)
    const result = await pending
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.value.items.length, 20)
      assert.equal(result.value.hasMore, true)
    }
    const narrowed = ctx.sessions.search('記録 24', new AbortController().signal)
    t.mock.timers.tick(400)
    const next = await narrowed
    assert.equal(next.ok, true)
    if (next.ok) {
      assert.equal(next.value.items.length, 1)
      assert.equal(next.value.hasMore, false)
    }
  } finally { ctx.dispose() }
})

test('偽検索は現在の題名と追加履歴を読み、共有履歴は表示窓の外も探す', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const ctx = createMockContext({ pageSize: 1, extensions: [{ extendMock }] })
  try {
    await ctx.sessions.binding('search-colors')!.session.rename('配色の最終確認')
    ctx.mock.addSession({ id: 'search-added', displayTitle: '追加の会話', running: false, blank: false, updatedAt: 1 }, [
      { type: 'user/message', seq: 0, time: 1, data: { content: [{ type: 'text', text: '途中で追加した本文' }] } },
    ])
    for (const [query, expectedId] of [['配色の最終確認', 'search-colors'], ['途中で追加した本文', 'search-added'], ['README の手順を見直して', 'readme-review']] as const) {
      const pending = ctx.sessions.search(query, new AbortController().signal)
      t.mock.timers.tick(400)
      const result = await pending
      assert.equal(result.ok, true)
      if (result.ok) assert.equal(result.value.items[0]?.sessionId, expectedId)
    }
    ctx.mock.removeSession('search-added')
    const pending = ctx.sessions.search('途中で追加した本文', new AbortController().signal)
    t.mock.timers.tick(400)
    const result = await pending
    assert.equal(result.ok, true)
    if (result.ok) assert.deepEqual(result.value.items, [])
  } finally { ctx.dispose() }
})
