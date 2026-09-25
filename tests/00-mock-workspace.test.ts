import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { MOCK_IDS } from '../web/src/dsh/mock/fixtures.ts'
import type { MockKit } from '../web/src/dsh/mock/kit.ts'

test('既存ワークスペースへ会話を追加しても並びと他の項目を保ち、更新を通知する', () => {
  const ctx = createMockContext()
  const workspaceId = MOCK_IDS.workspaces.m3e
  try {
    ctx.mock.addSession({ id: 'home-extra', displayTitle: '一覧に追加する会話', running: false, blank: true, updatedAt: 0 }, [])
    const previous = ctx.workspaces.list.getSnapshot()
    const original = previous.items.find((item) => item.workspaceId === workspaceId)!
    let notifications = 0
    const unsubscribe = ctx.workspaces.list.subscribe(() => { notifications++ })
    ctx.mock.updateWorkspace(workspaceId, { sessionIds: [...original.sessionIds, 'home-extra'] })
    const next = ctx.workspaces.list.getSnapshot()
    assert.equal(notifications, 1)
    assert.deepEqual(next.items.map((item) => item.workspaceId), previous.items.map((item) => item.workspaceId))
    assert.deepEqual(next.items[0], { ...original, sessionIds: [...original.sessionIds, 'home-extra'] })
    assert.notEqual(next.items[0], original)
    assert.equal(next.items[1], previous.items[1])
    assert.equal(next.items[2], previous.items[2])
    assert.equal(next.archivedSessionIds, previous.archivedSessionIds)
    assert.equal(next.phase, previous.phase)
    assert.equal(next.state, previous.state)
    assert.equal(next.error, previous.error)
    assert.deepEqual(original.sessionIds, [MOCK_IDS.sessions.readme, MOCK_IDS.sessions.approval])
    unsubscribe()
  } finally { ctx.dispose() }
})

test('ワークスペースの ID を変更させず、受け取った patch の変更から保存値を分離する', () => {
  const ctx = createMockContext()
  const workspaceId = MOCK_IDS.workspaces.harness
  try {
    const patch = { workspaceId: 'replaced-id', title: '更新後の場所', sessionIds: ['home-extra'] }
    ctx.mock.updateWorkspace(workspaceId, patch as unknown as Parameters<MockKit['updateWorkspace']>[1])
    patch.title = '呼び出し元が変更した名前'
    patch.sessionIds.push('later-id')
    const workspace = ctx.workspaces.list.getSnapshot().items.find((item) => item.workspaceId === workspaceId)!
    assert.equal(workspace.workspaceId, workspaceId)
    assert.equal(workspace.title, '更新後の場所')
    assert.deepEqual(workspace.sessionIds, ['home-extra'])
    assert.equal(ctx.workspaces.list.getSnapshot().items.some((item) => item.workspaceId === 'replaced-id'), false)
  } finally { ctx.dispose() }
})

test('存在しないワークスペースへの更新は例外にし、一覧も通知回数も変えない', () => {
  const ctx = createMockContext()
  try {
    const previous = ctx.workspaces.list.getSnapshot()
    let notifications = 0
    const unsubscribe = ctx.workspaces.list.subscribe(() => { notifications++ })
    assert.throws(() => ctx.mock.updateWorkspace('missing-workspace', { title: '更新しない' }), /ワークスペースが見つかりません: missing-workspace/)
    assert.equal(ctx.workspaces.list.getSnapshot(), previous)
    assert.equal(notifications, 0)
    unsubscribe()
  } finally { ctx.dispose() }
})

test('複数機能が同じワークスペースへ順番に追記しても先の追加と元の並びを維持する', () => {
  const ctx = createMockContext()
  const workspaceId = MOCK_IDS.workspaces.m3e
  try {
    const order = ctx.workspaces.list.getSnapshot().items.map((item) => item.workspaceId)
    const firstFeature = (kit: MockKit) => kit.updateWorkspace(workspaceId, (workspace) => ({ ...workspace, sessionIds: [...workspace.sessionIds, 'first-feature-session'] }))
    const secondFeature = (kit: MockKit) => kit.updateWorkspace(workspaceId, (workspace) => ({ sessionIds: [...workspace.sessionIds, 'second-feature-session'] }))
    firstFeature(ctx.mock)
    secondFeature(ctx.mock)
    const next = ctx.workspaces.list.getSnapshot()
    assert.deepEqual(next.items.map((item) => item.workspaceId), order)
    assert.deepEqual(next.items[0]?.sessionIds, [MOCK_IDS.sessions.readme, MOCK_IDS.sessions.approval, 'first-feature-session', 'second-feature-session'])
  } finally { ctx.dispose() }
})

test('更新関数へ渡した値の書き換えと例外は保存済みのワークスペースへ漏れない', () => {
  const ctx = createMockContext()
  const workspaceId = MOCK_IDS.workspaces.m3e
  try {
    const previous = ctx.workspaces.list.getSnapshot()
    const failure = new Error('更新を中止しました。')
    let notifications = 0
    const unsubscribe = ctx.workspaces.list.subscribe(() => { notifications++ })
    assert.throws(() => ctx.mock.updateWorkspace(workspaceId, (workspace) => {
      ;(workspace.sessionIds as string[]).push('uncommitted-session')
      throw failure
    }), (error) => error === failure)
    assert.equal(ctx.workspaces.list.getSnapshot(), previous)
    assert.deepEqual(previous.items[0]?.sessionIds, [MOCK_IDS.sessions.readme, MOCK_IDS.sessions.approval])
    assert.equal(notifications, 0)
    let borrowedIds: string[] | undefined
    ctx.mock.updateWorkspace(workspaceId, (workspace) => {
      borrowedIds = workspace.sessionIds as string[]
      borrowedIds.push('committed-session')
      return { workspaceId: 'ignored-id', sessionIds: borrowedIds }
    })
    borrowedIds!.push('late-mutation')
    assert.equal(notifications, 1)
    assert.equal(ctx.workspaces.list.getSnapshot().items[0]?.workspaceId, workspaceId)
    assert.deepEqual(ctx.workspaces.list.getSnapshot().items[0]?.sessionIds, [MOCK_IDS.sessions.readme, MOCK_IDS.sessions.approval, 'committed-session'])
    assert.deepEqual(previous.items[0]?.sessionIds, [MOCK_IDS.sessions.readme, MOCK_IDS.sessions.approval])
    unsubscribe()
  } finally { ctx.dispose() }
})
