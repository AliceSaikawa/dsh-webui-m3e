import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { InteractionStore, registerInteractionHandlers, type InteractionContext } from '../web/src/dsh/interactions-store.ts'
import { extendMock } from '../web/src/features/interactions/mock.ts'

async function advance(t: TestContext, milliseconds: number): Promise<void> {
  t.mock.timers.tick(milliseconds)
  await setImmediate()
}

function scenario(t: TestContext, name?: string) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const output: unknown[][] = []
  t.mock.method(console, 'info', (...values: unknown[]) => { output.push(values) })
  t.mock.method(console, 'warn', (...values: unknown[]) => { output.push(values) })
  const ctx = createMockContext({ scenario: name, extensions: [{ extendMock }] })
  const store = new InteractionStore()
  const dispose = registerInteractionHandlers(ctx as unknown as InteractionContext, store)
  t.after(async () => { dispose(); ctx.dispose(); await setImmediate() })
  return { ctx, store, output }
}

test('追加した質問とプランのセッションに日本語の題名と会話履歴があり、通常起動では要求しない', async (t) => {
  const { ctx, store, output } = scenario(t)
  const list = ctx.sessions.list.getSnapshot()
  assert.equal(list.byId['05-db-choice']?.displayTitle, 'DB の選び直し')
  assert.equal(list.byId['05-auth-redesign']?.displayTitle, '認証の作り直し')
  for (const id of ['05-db-choice', '05-auth-redesign']) {
    assert.equal(ctx.sessions.binding(id)?.eventSource.getSnapshot().entries[0]?.type, 'event')
  }
  await advance(t, 10_000)
  assert.deepEqual(store.getSnapshot(), [])
  assert.deepEqual(output, [])
})

test('05 専用ワークスペースの sessionIds から質問とプランの会話を取得できる', (t) => {
  const { ctx } = scenario(t)
  const workspaces = ctx.workspaces.list.getSnapshot()
  const workspace = workspaces.items.find(item => item.workspaceId === '05-interactions')
  assert.ok(workspace)
  assert.equal(workspace.title, '質問とプランの確認')
  assert.deepEqual(workspace.sessionIds, ['05-db-choice', '05-auth-redesign'])
  const list = ctx.sessions.list.getSnapshot()
  const visible = workspace.sessionIds.filter(id => !workspaces.archivedSessionIds.includes(id)).map(id => list.byId[id])
  assert.deepEqual(visible.map(session => session?.displayTitle), ['DB の選び直し', '認証の作り直し'])
  for (const id of workspace.sessionIds) {
    assert.equal(list.byId[id]?.cwd, workspace.path)
    assert.deepEqual(workspaces.items.filter(item => item.sessionIds.includes(id)).map(item => item.workspaceId), [workspace.workspaceId])
  }
})

for (const answer of ['allowed-once', 'rejected'] as const) {
  test(`承認は 3 秒後に届き、${answer} の返事を偽の DSH が受け取る`, async (t) => {
    const { store, output } = scenario(t, 'approval')
    await advance(t, 2_999)
    assert.equal(store.getSnapshot().length, 0)
    await advance(t, 1)
    const pending = store.getSnapshot()[0]!
    assert.equal(pending.kind, 'approval')
    assert.equal(pending.sessionId, 'approval-sheet')
    if (pending.kind !== 'approval') assert.fail('承認の要求がありません')
    assert.equal(pending.toolName, 'bash')
    assert.equal(pending.callId, 'approval-bash')
    assert.equal(Object.hasOwn(pending, 'arguments'), false)
    await pending.answer(answer)
    await setImmediate()
    assert.deepEqual(store.getSnapshot(), [])
    assert.deepEqual(output, [['偽の DSH が承認の回答を受け取りました。', answer]])
  })
}

test('質問は単一選択と説明付きの問い、複数選択の問いを持ち、保留しても返答も期限切れも起こらない', async (t) => {
  const { store, output } = scenario(t, 'question')
  assert.deepEqual(store.getSnapshot(), [])
  await advance(t, 100)
  const pending = store.getSnapshot()[0]!
  if (pending.kind !== 'question') assert.fail('質問の要求がありません')
  assert.equal(pending.sessionId, '05-db-choice')
  assert.equal(pending.items.length, 2)
  assert.equal(pending.items[0]?.question, 'どちらのデータベースにしますか')
  assert.equal(pending.items[0]?.multiSelect, undefined)
  assert.ok(pending.items[0]?.options?.every((option) => option.description))
  assert.equal(pending.items[1]?.multiSelect, true)

  store.defer(pending.key)
  await advance(t, 24 * 60 * 60 * 1_000)
  assert.equal(store.getSnapshot()[0]?.deferred, true)
  assert.deepEqual(output, [])
  store.resetDeferred('05-db-choice')
  assert.equal(store.getSnapshot()[0]?.deferred, false)
  const answer = { answers: [
    { id: pending.items[0]!.id, selected: ['PostgreSQL'] },
    { id: pending.items[1]!.id, selected: ['データの移行', '検索の速さ'], custom: '運用の手順も確かめたい' },
  ] }
  await pending.answer(answer)
  await setImmediate()
  assert.deepEqual(store.getSnapshot(), [])
  assert.deepEqual(output, [['偽の DSH が質問の回答を受け取りました。', answer]])
})

for (const revision of [false, true]) {
  test(`Canvas のプランを届け、${revision ? '修正の希望' : '承認'}を偽の DSH が受け取る`, async (t) => {
    const { store, output } = scenario(t, 'plan')
    assert.deepEqual(store.getSnapshot(), [])
    await advance(t, 100)
    const pending = store.getSnapshot()[0]!
    if (pending.kind !== 'question') assert.fail('プランの要求がありません')
    assert.equal(pending.sessionId, '05-auth-redesign')
    assert.equal(pending.items.length, 1)
    const item = pending.items[0]!
    assert.deepEqual(item.intent, { kind: 'plan-review', approve: 'このプランで進める' })
    assert.ok(item.options?.some(option => option.label === item.intent!.approve), '承認の文言と一致する選択肢が必要です')
    assert.equal(item.detail, '# 認証の作り直し\n\n1. ログインの Cookie を HttpOnly にする\n2. トークンの期限を 1 日にする\n3. 期限切れのときはログイン画面に戻す\n4. テストを 6 件足す')
    const answer = { answers: [{ id: item.id, selected: revision ? [] : [item.intent!.approve], ...(revision ? { custom: '期限は半日に直してほしい' } : {}) }] }
    await pending.answer(answer)
    await setImmediate()
    assert.deepEqual(store.getSnapshot(), [])
    assert.deepEqual(output, [['偽の DSH がプランの確認の回答を受け取りました。', answer]])
  })
}

test('承認の取消は要求から 5 秒後にだけ届き、待機一覧を片付ける', async (t) => {
  const { store, output } = scenario(t, 'approval-cancel')
  await advance(t, 3_000)
  const pending = store.getSnapshot()[0]!
  if (pending.kind !== 'approval') assert.fail('承認の要求がありません')
  await advance(t, 4_999)
  assert.equal(store.getSnapshot()[0]?.key, pending.key)
  assert.deepEqual(output, [])
  await advance(t, 1)
  assert.deepEqual(store.getSnapshot(), [])
  assert.deepEqual(output, [['偽の DSH：承認の要求は取り消されました。']])
  await assert.rejects(pending.answer('allowed-once'), /すでに終了/)
})

test('取消予定の承認に先に答えた場合は、その返事だけを受け取り後で取消表示を出さない', async (t) => {
  const { store, output } = scenario(t, 'approval-cancel')
  await advance(t, 3_000)
  const pending = store.getSnapshot()[0]!
  if (pending.kind !== 'approval') assert.fail('承認の要求がありません')
  await pending.answer('allowed-once')
  await setImmediate()
  await advance(t, 5_000)
  assert.deepEqual(store.getSnapshot(), [])
  assert.deepEqual(output, [['偽の DSH が承認の回答を受け取りました。', 'allowed-once']])
})
