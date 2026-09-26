import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openInboxSession } from '../web/src/features/inbox/session-navigation.ts'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { RemoteCallError } from '../web/src/dsh/remote-result.ts'
import type { ISessions, SessionSummary, SubagentAddress } from '../web/src/dsh/services.ts'

const parentId = 'inbox-navigation-parent'
const childId = 'inbox-child / 調査'
const child: SessionSummary = {
  id: childId, displayTitle: '調査の子の会話', origin: 'subagent', parentId,
  completed: true, running: false, blank: false, updatedAt: 1,
}

function fixture() {
  const ctx = createMockContext()
  ctx.mock.addSession({ id: parentId, displayTitle: '親の会話', running: false, blank: false, updatedAt: 0 }, [])
  ctx.mock.addSession(child, [])
  return ctx
}

for (const mode of ['one-shot', 'continuable'] as const) {
  test(`対応待ちの子を開く前に未取得の親カタログを読み、${mode}のアドレスで選択する`, async () => {
    const ctx = fixture()
    const steps: string[] = []
    const address: SubagentAddress = { parentSessionId: parentId, childSessionId: childId, mode }
    try {
      assert.equal(ctx.sessions.binding(childId)!.session.getSnapshot().subagent, null)
      const sessions: Pick<ISessions, 'list' | 'refreshSubagents' | 'openSubagent'> = {
        list: ctx.sessions.list,
        async refreshSubagents(id) {
          steps.push('catalog')
          assert.equal(id, parentId)
          ctx.mock.updateList(list => { list.subagentsByParent = {
            [id]: { state: 'ready', error: null, parentAvailable: true, entries: [{ id: childId, kind: 'child', mode }] },
          } })
        },
        openSubagent(value) {
          steps.push('select')
          assert.deepEqual(value, address)
          ctx.sessions.openSubagent(value)
        },
      }
      await openInboxSession(sessions, childId, path => {
        steps.push('navigate')
        assert.equal(path, `/s/${encodeURIComponent(childId)}`)
        // The Composer and menu's child checks must see this context before routing.
        assert.deepEqual(ctx.sessions.binding(childId)!.session.getSnapshot().subagent?.address, address)
        assert.deepEqual(ctx.sessions.list.getSnapshot().currentAddress, address)
        assert.equal(ctx.sessions.list.getSnapshot().current, childId)
        assert.equal(ctx.sessions.list.getSnapshot().byId[childId]?.completed, false)
      })
      assert.deepEqual(steps, ['catalog', 'select', 'navigate'])
    } finally { ctx.dispose() }
  })
}

test('取得済みの正しいカタログなら再取得せず、子の選択後にだけ遷移する', async () => {
  const ctx = fixture()
  const steps: string[] = []
  try {
    ctx.mock.updateList(list => { list.subagentsByParent = {
      [parentId]: { state: 'ready', error: null, entries: [{ id: childId, kind: 'child', mode: 'one-shot' }] },
    } })
    await openInboxSession({
      list: ctx.sessions.list,
      async refreshSubagents() { assert.fail('取得済みのカタログは再取得しない') },
      openSubagent(address) { steps.push('select'); ctx.sessions.openSubagent(address) },
    }, childId, () => { steps.push('navigate') })
    assert.deepEqual(steps, ['select', 'navigate'])
  } finally { ctx.dispose() }
})

test('通常の完了行はカタログ取得や子の選択をせず、URLをエンコードして遷移する', async () => {
  const ctx = fixture()
  const paths: string[] = []
  const normalId = 'done / 確認'
  try {
    ctx.mock.addSession({ ...child, id: normalId, origin: undefined, parentId: undefined }, [])
    await openInboxSession({
      list: ctx.sessions.list,
      async refreshSubagents() { assert.fail('通常の会話で親カタログは不要') },
      openSubagent() { assert.fail('通常の会話を子として選択しない') },
    }, normalId, path => { paths.push(path) })
    assert.deepEqual(paths, [`/s/${encodeURIComponent(normalId)}`])
    assert.equal(ctx.sessions.list.getSnapshot().current, undefined)
  } finally { ctx.dispose() }
})

test('カタログの取得失敗はエラーを返し、通常の会話として開くことも遷移もしない', async () => {
  const ctx = fixture()
  const failure = { code: 'gateway/timeout', message: 'timeout', details: {} }
  try {
    await assert.rejects(openInboxSession({
      list: ctx.sessions.list,
      async refreshSubagents() {
        ctx.mock.updateList(list => { list.subagentsByParent = { [parentId]: { state: 'error', error: failure } } })
      },
      openSubagent() { assert.fail('失敗後に選択しない') },
    }, childId, () => assert.fail('失敗後に遷移しない')), (error: unknown) => error instanceof RemoteCallError && error.rpcError.code === failure.code)
    assert.equal(ctx.sessions.list.getSnapshot().current, undefined)
    assert.equal(ctx.sessions.list.getSnapshot().byId[childId]?.completed, true)
  } finally { ctx.dispose() }
})

for (const entries of [[], [{ id: childId, kind: 'other', mode: 'one-shot' }], [{ id: childId, kind: 'child', mode: 'unknown' }]]) {
  test(`カタログに正しい子のアドレスがない場合は移動しない（${JSON.stringify(entries)}）`, async () => {
    const ctx = fixture()
    try {
      await assert.rejects(openInboxSession({
        list: ctx.sessions.list,
        async refreshSubagents() {
          ctx.mock.updateList(list => { list.subagentsByParent = { [parentId]: { state: 'ready', error: null, entries } } })
        },
        openSubagent() { assert.fail('不正なアドレスで選択しない') },
      }, childId, () => assert.fail('不正なアドレスで遷移しない')), /子の会話の情報を読み込めません/)
    } finally { ctx.dispose() }
  })
}

test('親の情報がない子や消えた完了行はURLだけで開かない', async () => {
  const ctx = fixture()
  try {
    ctx.mock.updateList(list => { delete list.byId[childId]!.parentId })
    const sessions = {
      list: ctx.sessions.list,
      async refreshSubagents() { assert.fail('親の不明な会話で取得しない') },
      openSubagent() { assert.fail('親の不明な会話で選択しない') },
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
      list: ctx.sessions.list,
      async refreshSubagents() { await fetched },
      openSubagent() { assert.fail('離脱後に選択しない') },
    }, childId, () => assert.fail('離脱後に遷移しない'), () => active)
    active = false
    finish()
    await opening
    assert.equal(ctx.sessions.list.getSnapshot().current, undefined)
    assert.equal(ctx.sessions.list.getSnapshot().byId[childId]?.completed, true)
  } finally { finish(); ctx.dispose() }
})

test('カタログの取得中に子が消えた場合は、古い行の情報で選択しない', async () => {
  const ctx = fixture()
  try {
    await assert.rejects(openInboxSession({
      list: ctx.sessions.list,
      async refreshSubagents() {
        ctx.mock.removeSession(childId)
        ctx.mock.updateList(list => { list.subagentsByParent = {
          [parentId]: { state: 'ready', error: null, entries: [{ id: childId, kind: 'child', mode: 'one-shot' }] },
        } })
      },
      openSubagent() { assert.fail('消えた子を選択しない') },
    }, childId, () => assert.fail('消えた子へ遷移しない')), /子の会話の情報が変わりました/)
  } finally { ctx.dispose() }
})

test('子の選択自体に失敗した場合も通常の会話へフォールバックしない', async () => {
  const ctx = fixture()
  try {
    ctx.mock.updateList(list => { list.subagentsByParent = {
      [parentId]: { state: 'ready', error: null, entries: [{ id: childId, kind: 'child', mode: 'one-shot' }] },
    } })
    await assert.rejects(openInboxSession({
      list: ctx.sessions.list,
      async refreshSubagents() { assert.fail('再取得しない') },
      openSubagent() { throw new Error('選択に失敗しました') },
    }, childId, () => assert.fail('選択の失敗後に遷移しない')), /選択に失敗/)
  } finally { ctx.dispose() }
})
