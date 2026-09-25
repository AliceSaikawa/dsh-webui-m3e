import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import type { RemoteResult } from '../web/src/dsh/services.ts'
import { extendMock, type SettingsMockRemote } from '../web/src/features/settings/mock.ts'
import { createSettingsStore, fieldKey, type SettingsApi } from '../web/src/features/settings/store.ts'
import type { SettingsDescription, SettingsNamespace } from '../web/src/features/settings/schema.ts'

const ns = 'agent-loop'
const failure = (code: string, message: string): RemoteResult<never> => ({ ok: false, error: { code, message, details: {} } })
const success = <T>(value: T): RemoteResult<T> => ({ ok: true, value: structuredClone(value) })
const tick = () => new Promise<void>(resolve => setImmediate(resolve))
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function harness(scenario?: string) {
  const ctx = createMockContext({ scenario, extensions: [{ extendMock }] })
  const remote = ctx.remote.settings as SettingsMockRemote
  const calls: { kind: 'update' | 'mutate'; ns: string; input: unknown; revision: number }[] = []
  let describes = 0
  const api: SettingsApi = {
    describe: () => { describes++; return remote.describe() },
    update: (name, patch, revision) => { calls.push({ kind: 'update', ns: name, input: structuredClone(patch), revision }); return remote.update(name, patch, revision) },
    mutate: (name, ops, revision) => { calls.push({ kind: 'mutate', ns: name, input: structuredClone(ops), revision }); return remote.mutate(name, ops, revision) },
  }
  const store = createSettingsStore(api)
  return { ctx, remote, api, calls, store, get describes() { return describes } }
}

function current(store: ReturnType<typeof createSettingsStore>, name = ns): SettingsNamespace {
  const row = store.getSnapshot().namespaces.find(item => item.ns === name)
  assert.ok(row)
  return row
}

function restartingHarness() {
  let row: SettingsNamespace = {
    ns, revision: 3, applies: 'live', value: { timeout: 45, name: '設定' }, user: {},
    schema: { uid: 0, refs: { 0: { type: 'object', dict: { timeout: 1, name: 2 } }, 1: { type: 'number' }, 2: { type: 'string' } } },
  }
  const revisions: number[] = []
  const api: SettingsApi = {
    describe: async () => success({ writable: true, namespaces: [row] }),
    update: async (_name, patch, revision) => {
      revisions.push(revision)
      if (revision !== row.revision) return failure('settings/conflict', 'ほかの場所で変更されました。')
      row = { ...row, revision: row.revision + 1, value: { ...row.value, ...patch }, user: { ...row.user, ...patch } }
      return success(row)
    },
    mutate: async () => failure('settings/rejected', 'このテストでは使いません。'),
  }
  return { api, revisions, store: createSettingsStore(api), restart: () => { row = { ...row, revision: 0 } } }
}

test('再接続では revision 3 の基準を 0 に更新し、続けて二回保存できる', async () => {
  const h = restartingHarness()
  const notices: string[] = []
  h.store.subscribeNotice(message => notices.push(message))
  assert.equal(await h.store.connectionChanged('connected'), true)
  assert.equal(current(h.store).revision, 3)
  await h.store.connectionChanged('disconnected')
  assert.equal(h.store.getSnapshot().writable, false)
  assert.equal(await h.store.edit(ns, ['timeout'], 50), false)
  h.restart()
  assert.equal(await h.store.connectionChanged('connected'), true)
  assert.equal(current(h.store).revision, 0)
  assert.equal(await h.store.edit(ns, ['timeout'], 60), true)
  assert.equal(await h.store.edit(ns, ['name'], '再起動後の設定'), true)
  assert.deepEqual(h.revisions, [0, 1])
  assert.equal(current(h.store).revision, 2)
  assert.equal(current(h.store).value.timeout, 60)
  assert.equal(current(h.store).value.name, '再起動後の設定')
  assert.deepEqual(notices, [])
})

test('再接続前の describe が後から届いても、新接続の revision 0 を上書きしない', async () => {
  const h = restartingHarness()
  await h.store.connectionChanged('connected')
  const original = h.api.describe
  const old = await original()
  const delayed = deferred<RemoteResult<SettingsDescription>>()
  h.api.describe = () => delayed.promise
  const reading = h.store.reload()
  await h.store.connectionChanged('disconnected')
  h.restart()
  h.api.describe = original
  await h.store.connectionChanged('connected')
  delayed.resolve(old)
  assert.equal(await reading, false)
  assert.equal(current(h.store).revision, 0)
  assert.equal(h.store.getSnapshot().writable, true)
})

test('再接続前の保存と待機中の編集を破棄し、古い保存を待たずに新しい保存を進める', async () => {
  const h = restartingHarness()
  await h.store.connectionChanged('connected')
  const oldRow = current(h.store)
  const original = h.api.update
  const delayed = deferred<RemoteResult<SettingsNamespace>>()
  h.api.update = () => delayed.promise
  const saving = h.store.edit(ns, ['timeout'], 88)
  const queued = h.store.edit(ns, ['name'], '古い接続の編集')
  await tick()
  await h.store.connectionChanged('connecting')
  h.restart()
  h.api.update = original
  await h.store.connectionChanged('connected')
  assert.equal(await h.store.edit(ns, ['timeout'], 66), true)
  delayed.resolve(success({ ...oldRow, revision: 4, value: { ...oldRow.value, timeout: 88 } }))
  assert.deepEqual(await Promise.all([saving, queued]), [false, false])
  assert.equal(current(h.store).revision, 1)
  assert.equal(current(h.store).value.timeout, 66)
  assert.equal(current(h.store).value.name, '設定')
  assert.deepEqual(h.revisions, [0])
  assert.equal(h.store.getSnapshot().busy[ns], false)
  assert.deepEqual(h.store.getSnapshot().fieldErrors, {})
})

test('再接続前の保存失敗は新接続のエラーや競合通知として表示しない', async () => {
  for (const outcome of ['conflict', 'rejected', 'throw'] as const) {
    const h = restartingHarness()
    const notices: string[] = []
    h.store.subscribeNotice(message => notices.push(message))
    await h.store.connectionChanged('connected')
    const delayed = deferred<void>()
    h.api.update = async () => {
      await delayed.promise
      if (outcome === 'throw') throw new Error('offline')
      return failure(`settings/${outcome}`, '以前の接続のエラーです。')
    }
    const saving = h.store.edit(ns, ['timeout'], 88)
    await tick()
    await h.store.connectionChanged('disconnected')
    h.restart()
    await h.store.connectionChanged('connected')
    delayed.resolve()
    assert.equal(await saving, false)
    assert.equal(current(h.store).revision, 0)
    assert.deepEqual(h.store.getSnapshot().fieldErrors, {})
    assert.deepEqual(notices, [])
  }
})

test('保存成功を公開し、入れ子の上書きを unset で既定値へ戻す', async () => {
  const h = harness()
  try {
    assert.equal(h.store.getSnapshot().phase, 'loading')
    assert.equal(await h.store.reload(), true)
    assert.equal(h.store.getSnapshot().phase, 'ready')
    assert.equal(await h.store.edit(ns, ['retry', 'interval'], 7), true)
    assert.deepEqual(current(h.store).value.retry, { enabled: true, interval: 7 })
    assert.deepEqual(current(h.store).user!.retry, { interval: 7 })
    assert.equal(current(h.store).revision, 2)
    assert.equal(await h.store.edit(ns, ['retry', 'interval']), true)
    assert.deepEqual(current(h.store).value.retry, { enabled: true, interval: 2 })
    assert.equal(Object.hasOwn(current(h.store).user!, 'retry'), false)
    assert.equal(current(h.store).revision, 3)
    assert.deepEqual(h.calls, [
      { kind: 'update', ns, input: { retry: { interval: 7 } }, revision: 1 },
      { kind: 'mutate', ns, input: [{ op: 'unset', path: ['retry', 'interval'] }], revision: 2 },
    ])
    assert.equal(h.store.getSnapshot().busy[ns], false)
  } finally { h.ctx.dispose() }
})

test('読み取り専用では保存と既定値への復帰の RPC を呼ばない', async () => {
  const h = harness('settings-readonly')
  try {
    assert.equal(await h.store.reload(), true)
    assert.equal(h.store.getSnapshot().writable, false)
    assert.equal(await h.store.edit(ns, ['enabled'], false), false)
    assert.equal(await h.store.edit(ns, ['timeout']), false)
    assert.deepEqual(h.calls, [])
    assert.equal(current(h.store).revision, 1)
  } finally { h.ctx.dispose() }
})

test('競合すると再読込して新しい revision を公開し、日本語で通知する', async () => {
  const h = harness('settings-conflict')
  try {
    const notices: string[] = []
    const stop = h.store.subscribeNotice(message => notices.push(message))
    await h.store.reload()
    assert.equal(await h.store.edit(ns, ['timeout'], 60), false)
    assert.equal(h.describes, 2)
    assert.equal(current(h.store).revision, 2)
    assert.equal(current(h.store).value.timeout, 45)
    assert.deepEqual(notices, ['ほかの場所で設定が変わりました。読み直しました'])
    assert.ok(h.store.getSnapshot().generation[ns]! > 0)
    assert.deepEqual(h.store.getSnapshot().fieldErrors, {})
    assert.equal(await h.store.edit(ns, ['timeout'], 60), true)
    assert.equal(h.calls[1]!.revision, 2)
    stop()
  } finally { h.ctx.dispose() }
})

test('競合後の再読込が失敗した場合は読み直せたという通知を出さない', async () => {
  const h = harness('settings-conflict')
  try {
    await h.store.reload()
    const notices: string[] = []
    h.store.subscribeNotice(message => notices.push(message))
    h.api.describe = async () => failure('connection/disconnected', '接続できません。')
    assert.equal(await h.store.edit(ns, ['timeout'], 60), false)
    assert.equal(h.store.getSnapshot().phase, 'error')
    assert.equal(h.store.getSnapshot().writable, false)
    assert.equal(notices.length, 1)
    assert.match(notices[0]!, /読み直せなかった/)
    assert.doesNotMatch(notices[0]!, /読み直しました/)
    assert.equal(h.store.getSnapshot().busy[ns], false)
  } finally { h.ctx.dispose() }
})

test('保存拒否は対象の項目だけに理由を出し、再試行が成功したら消す', async () => {
  const h = harness()
  try {
    await h.store.reload()
    const original = h.api.update
    h.api.update = async () => failure('settings/rejected', 'この値は管理者の設定によって許可されていません。')
    assert.equal(await h.store.edit(ns, ['timeout'], 70), false)
    assert.deepEqual(h.store.getSnapshot().fieldErrors, {
      [fieldKey(ns, ['timeout'])]: 'この値は管理者の設定によって許可されていません。',
    })
    assert.equal(current(h.store).value.timeout, 45)
    assert.equal(h.store.getSnapshot().busy[ns], false)
    h.api.update = original
    assert.equal(await h.store.edit(ns, ['timeout'], 70), true)
    assert.deepEqual(h.store.getSnapshot().fieldErrors, {})
    assert.equal(current(h.store).value.timeout, 70)
  } finally { h.ctx.dispose() }
})

test('通信例外と英語の拒否理由は日本語の項目エラーにする', async () => {
  const h = harness()
  try {
    await h.store.reload()
    h.api.update = async () => { throw new Error('offline') }
    assert.equal(await h.store.edit(ns, ['timeout'], 70), false)
    assert.equal(h.store.getSnapshot().fieldErrors[fieldKey(ns, ['timeout'])], '設定を保存できませんでした。接続を確認してください。')
    h.api.update = async () => failure('settings/rejected', 'Update rejected')
    assert.equal(await h.store.edit(ns, ['timeout'], 70), false)
    assert.equal(h.store.getSnapshot().fieldErrors[fieldKey(ns, ['timeout'])], 'この変更は保存できませんでした。入力内容と接続を確認してください。')
    assert.equal(h.store.getSnapshot().busy[ns], false)
  } finally { h.ctx.dispose() }
})

test('同時に編集した二つの項目を直列化し、後の保存へ新しい revision を渡す', async () => {
  const h = harness()
  try {
    await h.store.reload()
    const original = h.api.update
    const gate = deferred<void>()
    const revisions: number[] = []
    h.api.update = async (name, patch, revision) => {
      revisions.push(revision)
      if (revisions.length === 1) await gate.promise
      return original(name, patch, revision)
    }
    const first = h.store.edit(ns, ['timeout'], 60)
    const second = h.store.edit(ns, ['name'], '変更後の名前')
    await tick()
    assert.deepEqual(revisions, [1])
    assert.equal(h.store.getSnapshot().busy[ns], true)
    gate.resolve()
    assert.deepEqual(await Promise.all([first, second]), [true, true])
    assert.deepEqual(revisions, [1, 2])
    assert.equal(current(h.store).revision, 3)
    assert.equal(current(h.store).value.timeout, 60)
    assert.equal(current(h.store).value.name, '変更後の名前')
    assert.equal(h.store.getSnapshot().busy[ns], false)
  } finally { h.ctx.dispose() }
})

test('先行する保存が競合したとき、古い画面から待機中の編集を送らない', async () => {
  const h = harness('settings-conflict')
  try {
    await h.store.reload()
    const first = h.store.edit(ns, ['timeout'], 60)
    const second = h.store.edit(ns, ['name'], '古い画面の編集')
    assert.deepEqual(await Promise.all([first, second]), [false, false])
    assert.equal(h.calls.length, 1)
    assert.equal(current(h.store).revision, 2)
    assert.notEqual(current(h.store).value.name, '古い画面の編集')
  } finally { h.ctx.dispose() }
})

test('外部の更新通知で再読込し、古い revision や不正な通知は無視する', async () => {
  const h = harness()
  try {
    await h.store.reload()
    await h.remote.update(ns, { timeout: 90 }, 1)
    h.store.documentUpdated(ns, 2)
    await tick()
    assert.equal(h.describes, 2)
    assert.equal(current(h.store).revision, 2)
    assert.equal(current(h.store).value.timeout, 90)
    assert.equal(h.store.getSnapshot().generation[ns], 1)
    h.store.documentUpdated(ns, 2)
    h.store.documentUpdated(ns, 1)
    h.store.documentUpdated(null)
    await tick()
    assert.equal(h.describes, 2)
  } finally { h.ctx.dispose() }
})

test('保存中の更新通知は保存後にまとめて再読込する', async () => {
  const h = harness()
  try {
    await h.store.reload()
    const gate = deferred<void>()
    const original = h.api.update
    h.api.update = async (name, patch, revision) => { await gate.promise; return original(name, patch, revision) }
    const saving = h.store.edit(ns, ['timeout'], 55)
    await tick()
    h.store.documentUpdated(ns, 2)
    h.store.documentUpdated(ns, 3)
    assert.equal(h.describes, 1)
    gate.resolve()
    assert.equal(await saving, true)
    assert.equal(h.describes, 2)
    assert.equal(current(h.store).value.timeout, 55)
    assert.equal(current(h.store).revision, 2)
  } finally { h.ctx.dispose() }
})

test('保存前に開始した古い describe 応答で新しい保存結果を上書きしない', async () => {
  const h = harness()
  try {
    await h.store.reload()
    const old = await h.remote.describe()
    const delayed = deferred<RemoteResult<SettingsDescription>>()
    h.api.describe = () => delayed.promise
    const reading = h.store.reload()
    assert.equal(await h.store.edit(ns, ['timeout'], 88), true)
    assert.equal(current(h.store).revision, 2)
    delayed.resolve(old)
    assert.equal(await reading, false)
    assert.equal(current(h.store).revision, 2)
    assert.equal(current(h.store).value.timeout, 88)
  } finally { h.ctx.dispose() }
})

test('複数の describe が逆順に戻っても、最後に開始した読込だけを採用する', async () => {
  const h = harness()
  try {
    await h.store.reload()
    const old = await h.remote.describe()
    const delayed = deferred<RemoteResult<SettingsDescription>>()
    h.api.describe = () => delayed.promise
    const earlier = h.store.reload()
    await h.remote.update(ns, { timeout: 77 }, 1)
    h.api.describe = () => h.remote.describe()
    assert.equal(await h.store.reload(), true)
    delayed.resolve(old)
    assert.equal(await earlier, false)
    assert.equal(current(h.store).revision, 2)
    assert.equal(current(h.store).value.timeout, 77)
  } finally { h.ctx.dispose() }
})

test('伏せる項目、無効な項目、読み取り専用項目の保存を抑止する', async () => {
  const h = harness()
  try {
    const described = await h.remote.describe()
    assert.equal(described.ok, true)
    if (!described.ok) return
    const row = described.value.namespaces.find(item => item.ns === 'llm-deepseek')!
    const schema = row.schema as { uid: number; refs: Record<string, { dict?: Record<string, number>; type?: string; meta?: Record<string, unknown> }> }
    schema.refs['0']!.dict!.disabledValue = 17
    schema.refs['17'] = { type: 'string', meta: { disabled: true } }
    row.value.disabledValue = '固定された値'
    row.value.protectedInput = 'stored-key-not-for-editing'
    h.api.describe = async () => success(described.value)
    await h.store.reload()
    for (const path of [['protectedInput'], ['disabledValue'], ['models'], ['labels'], ['custom'], ['retry'], ['nonexistent']]) {
      assert.equal(await h.store.edit('llm-deepseek', path, '変更'), false, path.join('.'))
      assert.equal(await h.store.edit('llm-deepseek', path), false, path.join('.'))
    }
    assert.equal(await h.store.edit('missing-namespace', ['enabled'], false), false)
    assert.deepEqual(h.calls, [])
  } finally { h.ctx.dispose() }
})

test('通常の未設定の項目は初回から保存できる', async () => {
  const h = harness()
  try {
    const described = await h.remote.describe()
    assert.equal(described.ok, true)
    if (!described.ok) return
    const row = described.value.namespaces.find(item => item.ns === 'agent-default-model')!
    const schema = row.schema as { uid: number; refs: Record<string, { dict?: Record<string, number>; type?: string }> }
    schema.refs['0']!.dict!.reasoningEffort = 16
    schema.refs['16'] = { type: 'string' }
    h.api.describe = async () => success(described.value)
    h.api.update = async (name, patch, revision) => {
      h.calls.push({ kind: 'update', ns: name, input: patch, revision })
      return success({ ...row, revision: revision + 1, value: { ...row.value, ...patch }, user: patch })
    }
    await h.store.reload()
    assert.equal(await h.store.edit(row.ns, ['reasoningEffort'], 'high'), true)
    assert.equal(current(h.store, row.ns).value.reasoningEffort, 'high')
    assert.deepEqual(h.calls, [{ kind: 'update', ns: row.ns, input: { reasoningEffort: 'high' }, revision: row.revision }])
  } finally { h.ctx.dispose() }
})

test('購読解除後は状態変更と通知のコールバックを呼ばない', async () => {
  const h = harness('settings-conflict')
  try {
    let updates = 0
    let notices = 0
    const stopUpdates = h.store.subscribe(() => { updates++ })
    const stopNotices = h.store.subscribeNotice(() => { notices++ })
    await h.store.reload()
    assert.equal(updates, 1)
    stopUpdates()
    stopNotices()
    await h.store.edit(ns, ['timeout'], 60)
    assert.equal(updates, 1)
    assert.equal(notices, 0)
  } finally { h.ctx.dispose() }
})
