import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openInboxSession } from '../web/src/features/inbox/session-navigation.ts'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { RemoteCallError } from '../web/src/dsh/remote-result.ts'
import { conversationSelection } from '../web/src/dsh/conversation-selection.ts'
import { completionStatus } from '../web/src/dsh/completion-status.ts'
import type { ISessions, SessionSummary, SubagentAddress } from '../web/src/dsh/services.ts'

const parentId = 'inbox-navigation-parent'
const childId = 'inbox-child / 調査'
const child: SessionSummary = {
  id: childId, displayTitle: '調査の子の会話', origin: 'subagent', parentId,
  retainedBy: {}, running: false, blank: false, updatedAt: 1,
}

function fixture(mode: 'one-shot' | 'continuable' = 'one-shot') {
  const ctx = createMockContext()
  ctx.mock.addSession({ id: parentId, displayTitle: '親の会話', running: false, blank: false, updatedAt: 0 }, [])
  ctx.mock.addSession({ ...child, running: true }, [])
  ctx.mock.setProjection(childId, 'subagent', { mode, seq: 0 })
  ctx.mock.setSessionState(childId, { running: false })
  return ctx
}

for (const mode of ['one-shot', 'continuable'] as const) {
  test(`対応待ちの子を開く前に未取得の親カタログを読み、${mode}のアドレスで選択する`, async () => {
    const ctx = fixture(mode)
    const steps: string[] = []
    const address: SubagentAddress = { parentSessionId: parentId, childSessionId: childId, mode }
    try {
      assert.equal((await ctx.sessions.retain(childId, { source: 'm3e.test' }).ready).session.getSnapshot().subagent, null)
      const sessions: Pick<ISessions, keyof ISessions> = {
      ...ctx.sessions,
    list: ctx.sessions.list,
        async refreshProjections(id) {
          steps.push('catalog')
          assert.equal(id, parentId)
          ctx.mock.updateList(list => { list.projectionsBySession = {
            [id]: { state: 'ready', error: null, values: { subagentCatalog: [{ id: childId, createdAt: 0, label: '子', mode }] } },
          } })
        },
        retain(value, options) {
          steps.push(options.source === 'm3e.navigation' ? 'prepare' : 'select')
          assert.deepEqual(value, address)
          return ctx.sessions.retain(value, options)
        },
      }
      await openInboxSession(sessions, childId, path => {
        steps.push('navigate')
        assert.equal(path, `/s/${encodeURIComponent(childId)}`)
        // The Composer and menu's child checks must see this context before routing.
        assert.deepEqual(ctx.sessions.retain(childId, { source: 'm3e.test' }).binding.session.getSnapshot().subagent?.address, address)
        assert.deepEqual(ctx.sessions.binding(childId)?.session.getSnapshot().subagent?.address, address)
        assert.equal(ctx.sessions.retainInfo(childId).getSnapshot().retainedBy['m3e.mainView'], 1)
        assert.equal(completionStatus(ctx).getSnapshot().byId[childId]?.completionUnread, false)
      })
      assert.deepEqual(steps, ['catalog', 'prepare', 'select', 'navigate'])
    } finally { ctx.dispose() }
  })
}

test('取得済みの正しいカタログなら再取得せず、子の選択後にだけ遷移する', async () => {
  const ctx = fixture()
  const steps: string[] = []
  try {
    ctx.mock.updateList(list => { list.projectionsBySession = {
      [parentId]: { state: 'ready', error: null, values: { subagentCatalog: [{ id: childId, createdAt: 0, mode: 'one-shot' }] } },
    } })
    await openInboxSession({
      ...ctx.sessions,
    list: ctx.sessions.list,
      async refreshProjections() { assert.fail('取得済みのカタログは再取得しない') },
      retain(address, options) { steps.push(options.source === 'm3e.navigation' ? 'prepare' : 'select'); return ctx.sessions.retain(address, options) },
    }, childId, () => { steps.push('navigate') })
    assert.deepEqual(steps, ['prepare', 'select', 'navigate'])
    assert.deepEqual(ctx.sessions.retainInfo(childId).getSnapshot(), { referenceCount: 1, retainedBy: { 'm3e.mainView': 1 } })
  } finally { ctx.dispose() }
})

test('通常の完了行はカタログ取得や子の選択をせず、URLをエンコードして遷移する', async () => {
  const ctx = fixture()
  const paths: string[] = []
  const normalId = 'done / 確認'
  try {
    ctx.mock.addSession({ ...child, id: normalId, origin: undefined, parentId: undefined }, [])
    await openInboxSession({
      ...ctx.sessions,
    list: ctx.sessions.list,
      async refreshProjections() { assert.fail('通常の会話で親カタログは不要') },
      retain() { assert.fail('通常の会話を子として選択しない') },
    }, normalId, path => { paths.push(path) })
    assert.deepEqual(paths, [`/s/${encodeURIComponent(normalId)}`])
    assert.equal(conversationSelection(ctx.sessions).state.getSnapshot().sessionId, undefined)
  } finally { ctx.dispose() }
})

test('カタログの取得失敗はエラーを返し、通常の会話として開くことも遷移もしない', async () => {
  const ctx = fixture()
  const failure = { code: 'gateway/timeout', message: 'timeout', details: {} }
  try {
    await assert.rejects(openInboxSession({
      ...ctx.sessions,
    list: ctx.sessions.list,
      async refreshProjections() {
        ctx.mock.updateList(list => { list.projectionsBySession = { [parentId]: { state: 'error', error: failure, values: {} } } })
      },
      retain() { assert.fail('失敗後に選択しない') },
    }, childId, () => assert.fail('失敗後に遷移しない')), (error: unknown) => error instanceof RemoteCallError && error.rpcError.code === failure.code)
    assert.equal(conversationSelection(ctx.sessions).state.getSnapshot().sessionId, undefined)
    assert.equal(completionStatus(ctx).getSnapshot().byId[childId]?.completionUnread, true)
  } finally { ctx.dispose() }
})

for (const entries of [[], [{ id: 'different-child', createdAt: 0, mode: 'one-shot' as const }], [{ id: childId, createdAt: 0, mode: 'unknown' as const }]]) {
  test(`カタログに正しい子のアドレスがない場合は移動しない（${JSON.stringify(entries)}）`, async () => {
    const ctx = fixture()
    try {
      await assert.rejects(openInboxSession({
      ...ctx.sessions,
    list: ctx.sessions.list,
        async refreshProjections() {
          ctx.mock.updateList(list => { list.projectionsBySession = { [parentId]: { state: 'ready', error: null, values: { subagentCatalog: entries } } } })
        },
        retain() { assert.fail('不正なアドレスで選択しない') },
      }, childId, () => assert.fail('不正なアドレスで遷移しない')), /子の会話の情報を読み込めません/)
    } finally { ctx.dispose() }
  })
}

test('親の情報がない子や消えた完了行はURLだけで開かない', async () => {
  const ctx = fixture()
  try {
    ctx.mock.updateList(list => { delete list.byId[childId]!.parentId })
    const sessions = {
      ...ctx.sessions,
    list: ctx.sessions.list,
      async refreshProjections() { assert.fail('親の不明な会話で取得しない') },
      retain() { assert.fail('親の不明な会話で選択しない') },
    }
    await assert.rejects(openInboxSession(sessions, childId, () => assert.fail('遷移しない')), /親の会話が見つかりません/)
    await assert.rejects(openInboxSession(sessions, 'missing', () => assert.fail('遷移しない')), /会話が見つかりません/)
  } finally { ctx.dispose() }
})

test('画面離脱や別の操作の後にカタログが届いても、子を選択せず遷移しない', async () => {
  const ctx = fixture()
  let active = true
  let finish!: () => void
  const fetched = new Promise<void>(resolve => { finish = resolve })
  try {
    const opening = openInboxSession({
      ...ctx.sessions,
    list: ctx.sessions.list,
      async refreshProjections() { await fetched },
      retain() { assert.fail('離脱後に選択しない') },
    }, childId, () => assert.fail('離脱後に遷移しない'), () => active)
    active = false
    finish()
    await opening
    assert.equal(conversationSelection(ctx.sessions).state.getSnapshot().sessionId, undefined)
    assert.equal(completionStatus(ctx).getSnapshot().byId[childId]?.completionUnread, true)
  } finally { finish(); ctx.dispose() }
})

test('カタログの取得中に子が消えた場合は、古い行の情報で選択しない', async () => {
  const ctx = fixture()
  try {
    await assert.rejects(openInboxSession({
      ...ctx.sessions,
    list: ctx.sessions.list,
      async refreshProjections() {
        ctx.mock.removeSession(childId)
        ctx.mock.updateList(list => { list.projectionsBySession = {
          [parentId]: { state: 'ready', error: null, values: { subagentCatalog: [{ id: childId, createdAt: 0, mode: 'one-shot' }] } },
        } })
      },
      retain() { assert.fail('消えた子を選択しない') },
    }, childId, () => assert.fail('消えた子へ遷移しない')), /子の会話の情報が変わりました/)
  } finally { ctx.dispose() }
})

test('子の選択自体に失敗した場合も通常の会話へフォールバックしない', async () => {
  const ctx = fixture()
  try {
    ctx.mock.updateList(list => { list.projectionsBySession = {
      [parentId]: { state: 'ready', error: null, values: { subagentCatalog: [{ id: childId, createdAt: 0, mode: 'one-shot' }] } },
    } })
    await assert.rejects(openInboxSession({
      ...ctx.sessions,
    list: ctx.sessions.list,
      async refreshProjections() { assert.fail('再取得しない') },
      retain() { throw new Error('選択に失敗しました') },
    }, childId, () => assert.fail('選択の失敗後に遷移しない')), /選択に失敗/)
  } finally { ctx.dispose() }
})
