import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { MOCK_IDS, approvalRecords, readmeRecords } from '../web/src/dsh/mock/fixtures.ts'
import { InteractionStore, registerInteractionHandlers, type InteractionContext } from '../web/src/dsh/interactions-store.ts'
import { foldSessionWindow } from '../web/src/dsh/session-journal.ts'
import { createDirectoryMock } from '../web/src/features/home/directory-mock.ts'
import { extendMock, HOME_MOCK_IDS } from '../web/src/features/home/mock.ts'

const extension = { extendMock }

test('ホームの偽データは共有履歴を保ち、3 ワークスペースと状態の異なる 7 会話を用意する', () => {
  const ctx = createMockContext({ extensions: [extension] })
  try {
    const workspaces = ctx.workspaces.list.getSnapshot().items
    const list = ctx.sessions.list.getSnapshot()
    assert.deepEqual(workspaces.map((workspace) => workspace.workspaceId), Object.values(MOCK_IDS.workspaces))
    assert.deepEqual(workspaces.map((workspace) => workspace.sessionIds.length), [6, 1, 0])
    assert.equal(list.ids.length, 7)
    assert.equal(list.byId[MOCK_IDS.sessions.approval]?.running, true)
    assert.equal(list.byId[HOME_MOCK_IDS.completed]?.completed, true)
    assert.equal(list.byId[HOME_MOCK_IDS.child]?.origin, 'subagent')
    assert.equal(list.byId[HOME_MOCK_IDS.child]?.parentId, MOCK_IDS.sessions.readme)
    for (const workspace of workspaces) for (const id of workspace.sessionIds) assert.ok(list.byId[id])
    assert.deepEqual(foldSessionWindow(ctx.sessions.binding(MOCK_IDS.sessions.readme)!.eventSource.getSnapshot()).records, readmeRecords)
    assert.deepEqual(foldSessionWindow(ctx.sessions.binding(MOCK_IDS.sessions.approval)!.eventSource.getSnapshot()).records, approvalRecords)
    assert.deepEqual(list.byId[MOCK_IDS.sessions.readme]?.projectionValues?.modelSelection, { lastUsed: { provider: 'deepseek', model: 'deepseek-chat' } })
  } finally { ctx.dispose() }
})

test('返事待ちの会話はハンドラ登録後に質問を受け取り、回答で待ち状態を解消する', { timeout: 2000 }, async () => {
  const ctx = createMockContext({ extensions: [extension] })
  const store = new InteractionStore()
  const dispose = registerInteractionHandlers(ctx as unknown as InteractionContext, store)
  try {
    assert.equal(store.getSnapshot().length, 0)
    await new Promise<void>((resolve) => {
      const unsubscribe = store.subscribe(() => {
        if (store.getSnapshot().length > 0) { unsubscribe(); resolve() }
      })
    })
    const pending = store.getSnapshot()[0]
    assert.equal(pending?.sessionId, HOME_MOCK_IDS.waiting)
    if (pending?.kind !== 'question') assert.fail('質問が届きませんでした。')
    assert.equal(pending.items[0]?.id, 'home-workspace-choice')
    await pending.answer({ answers: [{ id: 'home-workspace-choice', selected: ['今のワークスペース'] }] })
    assert.equal(store.getSnapshot().length, 0)
  } finally { dispose(); ctx.dispose() }
})

test('フォルダはホームから階層をたどれ、隠し属性とパンくずを返す', async () => {
  const picker = createDirectoryMock()
  const home = await picker.list()
  assert.equal(home.ok, true)
  if (!home.ok) assert.fail('ホームがありません。')
  assert.equal(home.value.path, '/mock')
  assert.equal(home.value.home, '/mock')
  assert.equal(home.value.entries.find((entry) => entry.name === '.cache')?.hidden, true)
  assert.equal(home.value.entries.find((entry) => entry.name === 'dev')?.hidden, false)
  const dev = await picker.list('/mock/dev')
  if (!dev.ok) assert.fail('開発フォルダがありません。')
  assert.ok(dev.value.entries.some((entry) => entry.path === '/mock/dev/dsh-webui-m3e'))
  const project = await picker.list('/mock/dev/dsh-webui-m3e/')
  if (!project.ok) assert.fail('プロジェクトがありません。')
  assert.deepEqual(project.value.crumbs.map((crumb) => crumb.path), ['/', '/mock', '/mock/dev', '/mock/dev/dsh-webui-m3e'])
  assert.deepEqual(project.value.entries.map((entry) => entry.name), ['docs', 'web'])
  assert.equal(Object.hasOwn(picker, 'capability'), false)
})

test('フォルダ作成は絶対パスを返し、一覧への反映と重複を確認できる', async () => {
  const picker = createDirectoryMock()
  const result = await picker.createDirectory('/mock/dev', ' 新しい作業 ')
  assert.deepEqual(result, { ok: true, value: '/mock/dev/新しい作業' })
  const listing = await picker.list('/mock/dev')
  if (!listing.ok) assert.fail('作成先を読み込めません。')
  assert.ok(listing.value.entries.some((entry) => entry.path === '/mock/dev/新しい作業'))
  const created = await picker.list('/mock/dev/新しい作業')
  if (!created.ok) assert.fail('作成したフォルダを開けません。')
  assert.deepEqual(created.value.entries, [])
  const duplicate = await picker.createDirectory('/mock/dev', '新しい作業')
  assert.equal(duplicate.ok, false)
  if (!duplicate.ok) assert.equal(duplicate.error.code, 'directory-picker/exists')
})

test('フォルダ名の不備・読み取り失敗・書き込み失敗を RPC の失敗として返す', async () => {
  const picker = createDirectoryMock()
  for (const name of ['', '.', '..', 'a/b', 'a\\b']) {
    const result = await picker.createDirectory('/mock/dev', name)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error.code, 'directory-picker/invalid-name')
  }
  for (const path of ['/mock/unreadable', '/mock/missing']) {
    const result = await picker.list(path)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error.code, 'directory-picker/unreadable')
  }
  const write = await picker.createDirectory('/mock/read-only', '新規')
  assert.equal(write.ok, false)
  if (!write.ok) assert.equal(write.error.code, 'directory-picker/create-failed')
  const cancelled = await picker.list('/mock', AbortSignal.abort())
  assert.equal(cancelled.ok, false)
  if (!cancelled.ok) assert.equal(cancelled.error.code, 'rpc/aborted')
})

test('empty は会話を除き、no-workspace はワークスペースも除く', () => {
  for (const scenario of ['empty', 'no-workspace']) {
    const ctx = createMockContext({ scenario, extensions: [extension] })
    try {
      assert.deepEqual(ctx.sessions.list.getSnapshot().ids, [])
      assert.deepEqual(ctx.sessions.list.getSnapshot().byId, {})
      assert.ok(ctx.workspaces.list.getSnapshot().items.every((workspace) => workspace.sessionIds.length === 0))
      assert.equal(ctx.workspaces.list.getSnapshot().items.length, scenario === 'empty' ? 3 : 0)
      assert.equal(ctx.sessions.binding(HOME_MOCK_IDS.waiting), undefined)
    } finally { ctx.dispose() }
  }
})

test('home-pending は一覧読み込み中の状態を用意する', () => {
  const ctx = createMockContext({ scenario: 'home-pending', extensions: [extension] })
  try { assert.equal(ctx.sessions.list.getSnapshot().phase, 'pending') }
  finally { ctx.dispose() }
})

test('native の閲覧可否と利用不可のシナリオは list の応答で判別できる', async () => {
  for (const scenario of ['native-browse', 'native-unavailable', 'picker-unavailable']) {
    const ctx = createMockContext({ scenario, extensions: [extension] })
    try {
      const picker = ctx.remote.directoryPicker as ReturnType<typeof createDirectoryMock>
      const listing = await picker.list()
      if (scenario === 'native-browse') {
        assert.equal(listing.ok, true)
      } else {
        assert.equal(listing.ok, false)
        if (listing.ok) assert.fail('利用不可のはずです。')
        assert.equal(listing.error.code, 'directory-picker/unavailable')
        assert.equal(listing.error.details.capability, scenario === 'native-unavailable' ? 'native' : 'none')
        const creation = await picker.createDirectory('/mock', '新規')
        assert.equal(creation.ok, false)
        if (!creation.ok) assert.equal(creation.error.code, 'directory-picker/unavailable')
      }
    } finally { ctx.dispose() }
  }
})

test('picker-truncated は 1,000 件だけを返し、省略を通知する', async () => {
  const ctx = createMockContext({ scenario: 'picker-truncated', extensions: [extension] })
  try {
    const picker = ctx.remote.directoryPicker as ReturnType<typeof createDirectoryMock>
    const result = await picker.list()
    if (!result.ok) assert.fail('一覧がありません。')
    assert.equal(result.value.truncated, true)
    assert.equal(result.value.entries.length, 1000)
    const project = await picker.list('/mock/dev/dsh-webui-m3e')
    if (!project.ok) assert.fail('プロジェクトがありません。')
    assert.equal(project.value.truncated, false)
  } finally { ctx.dispose() }
})

test('偽データのコンテキスト間でフォルダとアーカイブの変更を共有しない', async () => {
  const first = createMockContext({ extensions: [extension] })
  const second = createMockContext({ extensions: [extension] })
  try {
    const firstPicker = first.remote.directoryPicker as ReturnType<typeof createDirectoryMock>
    const secondPicker = second.remote.directoryPicker as ReturnType<typeof createDirectoryMock>
    await firstPicker.createDirectory('/mock/dev', 'この画面だけ')
    await first.workspaces.archiveSession(HOME_MOCK_IDS.completed)
    assert.equal((await secondPicker.list('/mock/dev/この画面だけ')).ok, false)
    assert.deepEqual(second.workspaces.list.getSnapshot().archivedSessionIds, [])
    assert.equal(second.sessions.list.getSnapshot().byId[HOME_MOCK_IDS.completed]?.completed, true)
  } finally { first.dispose(); second.dispose() }
})
