import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import type { RemoteResult } from '../web/src/dsh/services.ts'
import { extendMock, type SettingsMockRemote } from '../web/src/features/settings/mock.ts'
import { createSettingsStore, fieldKey, type SettingsApi } from '../web/src/features/settings/store.ts'
import { parseFieldInput, schemaFields, type SettingsDescription, type SettingsNamespace } from '../web/src/features/settings/schema.ts'
import { modelResetOperations, modelSaveOperations, subagentSelection } from '../web/src/features/settings/model-settings.ts'

const ns = 'example-extension'
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
    ns, autoGenerate: true, revision: 3, applies: 'live', value: { timeout: 45, name: '設定' }, user: {},
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

test('同じ接続で revision が 3 から 0 に戻っても、競合後に読み直して二回保存できる', async () => {
  const h = restartingHarness()
  const notices: string[] = []
  h.store.subscribeNotice(message => notices.push(message))
  await h.store.connectionChanged('connected')
  assert.equal(current(h.store).revision, 3)
  const generation = h.store.getSnapshot().generation[ns] ?? 0
  h.restart()
  assert.equal(await h.store.edit(ns, ['timeout'], 60), false)
  assert.equal(current(h.store).revision, 0)
  assert.ok(h.store.getSnapshot().generation[ns]! > generation)
  assert.deepEqual(notices, ['ほかの場所で設定が変わりました。読み直しました'])
  assert.equal(await h.store.edit(ns, ['timeout'], 60), true)
  assert.equal(await h.store.edit(ns, ['name'], '再登録後の設定'), true)
  assert.deepEqual(h.revisions, [3, 0, 1])
  assert.equal(current(h.store).revision, 2)
  assert.equal(current(h.store).value.timeout, 60)
  assert.equal(current(h.store).value.name, '再登録後の設定')
})

test('同じ接続の小さい revision の通知でも再読込し、同じ番号だけを無視する', async () => {
  const h = restartingHarness()
  const original = h.api.describe
  let describes = 0
  h.api.describe = () => { describes++; return original() }
  await h.store.connectionChanged('connected')
  h.store.documentUpdated(ns, 3)
  await tick()
  assert.equal(describes, 1)
  h.restart()
  h.store.documentUpdated(ns, 0)
  await tick()
  assert.equal(describes, 2)
  assert.equal(current(h.store).revision, 0)
  assert.equal(await h.store.edit(ns, ['timeout'], 60), true)
  assert.deepEqual(h.revisions, [0])
})

test('同じ接続で新しい読込の revision が小さくても、遅れて届いた古い高い revision は捨てる', async () => {
  const h = restartingHarness()
  await h.store.connectionChanged('connected')
  const original = h.api.describe
  const old = await original()
  const delayed = deferred<RemoteResult<SettingsDescription>>()
  h.api.describe = () => delayed.promise
  const earlier = h.store.reload()
  h.restart()
  h.api.describe = original
  assert.equal(await h.store.reload(), true)
  assert.equal(current(h.store).revision, 0)
  delayed.resolve(old)
  assert.equal(await earlier, false)
  assert.equal(current(h.store).revision, 0)
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

test('外部の更新通知で再読込し、同じ revision や不正な通知は無視する', async () => {
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
    const row = described.value.namespaces.find(item => item.ns === 'example-extension')!
    const schema = row.schema as { uid: number; refs: Record<string, { dict?: Record<string, number>; type?: string; meta?: Record<string, unknown> }> }
    schema.refs['0']!.dict!.disabledValue = 17
    schema.refs['17'] = { type: 'string', meta: { disabled: true } }
    row.value.disabledValue = '固定された値'
    row.value.protectedInput = 'stored-key-not-for-editing'
    h.api.describe = async () => success(described.value)
    await h.store.reload()
    for (const path of [['protectedInput'], ['disabledValue'], ['models'], ['labels'], ['custom'], ['nonexistent']]) {
      assert.equal(await h.store.edit('example-extension', path, '変更'), false, path.join('.'))
      assert.equal(await h.store.edit('example-extension', path), false, path.join('.'))
    }
    assert.equal(await h.store.edit('example-extension', ['retry'], { interval: 8 }), false)
    assert.equal(await h.store.edit('missing-namespace', ['enabled'], false), false)
    assert.deepEqual(h.calls, [])
  } finally { h.ctx.dispose() }
})

test('配列・辞書・未知型・入れ子は unset だけで既定値へ戻し、兄弟の上書きを保つ', async () => {
  const h = harness()
  try {
    assert.equal((await h.remote.update(ns, { models: ['変更'], labels: { extra: '追加' }, custom: { nested: true } }, 1)).ok, true)
    await h.store.reload()
    let revision = current(h.store).revision
    for (const key of ['models', 'labels', 'custom', 'retry']) {
      assert.equal(await h.store.edit(ns, [key], { replacement: true }), false)
      assert.equal(await h.store.edit(ns, [key]), true)
      assert.deepEqual(h.calls.at(-1), { kind: 'mutate', ns, input: [{ op: 'unset', path: [key] }], revision })
      revision++
      const row = current(h.store)
      assert.equal(row.revision, revision)
      assert.deepEqual(row.value[key], row.base![key])
      assert.equal(Object.hasOwn(row.user!, key), false)
      assert.equal(row.value.timeout, 45)
      assert.equal(row.user!.timeout, 45)
      assert.equal(await h.store.edit(ns, [key]), false)
    }
  } finally { h.ctx.dispose() }
})

test('複合値の復帰も書き込み不可・無効・保護された子を確認して送信を止める', async () => {
  for (const mode of ['readonly', 'disabled', 'masked'] as const) {
    const h = harness()
    try {
      const described = await h.remote.describe()
      assert.ok(described.ok)
      const row = described.value.namespaces.find(item => item.ns === ns)!
      if (mode === 'readonly') described.value.writable = false
      if (mode === 'masked') row.secrets = [{ path: ['retry', 'interval'], set: true }]
      if (mode === 'disabled') {
        const schema = row.schema as { refs: Record<string, { meta?: Record<string, unknown> }> }
        schema.refs['10']!.meta = { disabled: true }
      }
      h.api.describe = async () => success(described.value)
      await h.store.reload()
      assert.equal(await h.store.edit(ns, ['retry']), false)
      assert.equal(await h.store.edit(ns, ['retry', 'interval']), false)
      assert.deepEqual(h.calls, [])
    } finally { h.ctx.dispose() }
  }
})

test('まとまりの復帰で前の子の編集を破棄し、次の世代で新しく編集できる', async () => {
  const h = harness()
  try {
    await h.store.reload()
    const generation = h.store.getSnapshot().generation[ns] ?? 0
    const gate = deferred<void>()
    const original = h.api.mutate
    h.api.mutate = async (name, ops, revision) => { await gate.promise; return original(name, ops, revision) }
    const resetting = h.store.edit(ns, ['retry'])
    const queued = h.store.edit(ns, ['retry', 'interval'], 9)
    await tick()
    assert.equal(h.store.getSnapshot().busy[ns], true)
    gate.resolve()
    assert.deepEqual(await Promise.all([resetting, queued]), [true, false])
    assert.ok(h.store.getSnapshot().generation[ns]! > generation)
    assert.deepEqual(current(h.store).value.retry, current(h.store).base!.retry)
    assert.equal(await h.store.edit(ns, ['retry', 'interval'], 8), true)
    assert.deepEqual(h.calls.map(call => call.kind), ['mutate', 'update'])
  } finally { h.ctx.dispose() }
})

test('複合値の復帰の競合は読み直し、待機していた復帰も破棄する', async () => {
  const h = harness('settings-conflict')
  try {
    await h.store.reload()
    const notices: string[] = []
    h.store.subscribeNotice(message => notices.push(message))
    assert.deepEqual(await Promise.all([h.store.edit(ns, ['retry']), h.store.edit(ns, ['retry'])]), [false, false])
    assert.equal(h.calls.length, 1)
    assert.deepEqual(notices, ['ほかの場所で設定が変わりました。読み直しました'])
    assert.equal(await h.store.edit(ns, ['retry']), true)
    assert.deepEqual(current(h.store).value.retry, current(h.store).base!.retry)
  } finally { h.ctx.dispose() }
})

test('通常の未設定の項目は初回から保存できる', async () => {
  const h = harness()
  try {
    const described = await h.remote.describe()
    assert.equal(described.ok, true)
    if (!described.ok) return
    const row = described.value.namespaces.find(item => item.ns === 'agent-default-model')!
    row.user = {}
    row.value = { ...row.base }
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

test('任意の文字項目を空欄にすると unset で上書きを消し、ほかの設定を保つ', async () => {
  const h = harness()
  try {
    await h.store.reload()
    const name = 'agent-default-model'
    const before = current(h.store, name)
    let revision = before.revision
    for (const input of ['', '   ']) {
      assert.equal(await h.store.edit(name, ['reasoningEffort'], 'high'), true)
      revision++
      const field = schemaFields(current(h.store, name)).find(item => item.path[0] === 'reasoningEffort')
      assert.ok(field)
      const parsed = parseFieldInput(field, input)
      assert.deepEqual(parsed, { ok: true, value: undefined })
      if (!parsed.ok) return
      assert.equal(await h.store.edit(name, field.path, parsed.value), true)
      assert.deepEqual(h.calls.at(-1), { kind: 'mutate', ns: name, input: [{ op: 'unset', path: ['reasoningEffort'] }], revision })
      revision++
      const after = current(h.store, name)
      assert.equal(after.revision, revision)
      assert.equal(Object.hasOwn(after.value, 'reasoningEffort'), false)
      assert.equal(Object.hasOwn(after.user!, 'reasoningEffort'), false)
      assert.deepEqual(after.value, before.base)
      assert.deepEqual(after.user, {})
    }
  } finally { h.ctx.dispose() }
})

test('既定モデルの完全な変更と復帰はそれぞれ一度の書き込みで行う', async () => {
  const h = harness()
  try {
    await h.store.reload()
    assert.equal(await h.store.editModelSettings('agent-default-model', () =>
      modelSaveOperations({ provider: 'ollama', model: 'local' })), true)
    assert.deepEqual(current(h.store, 'agent-default-model').value, { provider: 'ollama', model: 'local' })
    assert.deepEqual(h.calls, [{ kind: 'mutate', ns: 'agent-default-model', revision: 1, input: modelSaveOperations({ provider: 'ollama', model: 'local' }) }])
    assert.equal(await h.store.editModelSettings('agent-default-model', () => modelResetOperations, true), true)
    assert.deepEqual(current(h.store, 'agent-default-model').value, { provider: 'deepseek', model: 'deepseek-v4' })
    assert.equal(h.calls.length, 2)
  } finally { h.ctx.dispose() }
})

test('続けて選んだサブエージェントのモデルは直列化して両方残す', async () => {
  const h = harness()
  try {
    await h.store.reload()
    const routeA = { provider: 'deepseek', model: 'deepseek-v4' }
    const routeB = { provider: 'ollama', model: 'local' }
    const add = (target: typeof routeA) => h.store.editModelSettings('subagent-model-selection-settings', row => [
      { op: 'set', path: ['allowedModels'], value: [
        ...subagentSelection(row.value).allowedModels.map(item => ({ provider: item.provider, model: item.model })), target,
      ] },
    ])
    assert.deepEqual(await Promise.all([add(routeA), add(routeB)]), [true, true])
    assert.deepEqual(subagentSelection(current(h.store, 'subagent-model-selection-settings').value).allowedModels, [routeA, routeB])
    assert.equal(h.calls.filter(call => call.ns === 'subagent-model-selection-settings' && call.kind === 'mutate').length, 2)
  } finally { h.ctx.dispose() }
})

test('許可モデルが空なら有効化を拒否し、無効中の選択後は有効化できる', async () => {
  const h = harness()
  try {
    await h.store.reload()
    const name = 'subagent-model-selection-settings'
    const route = { provider: 'deepseek', model: 'deepseek-v4' }
    assert.equal(await h.store.editModelSettings(name, () => [
      { op: 'set', path: ['enabled'], value: true },
    ]), false)
    assert.equal(subagentSelection(current(h.store, name).value).enabled, false)
    assert.equal(await h.store.editModelSettings(name, () => [
      { op: 'set', path: ['allowedModels'], value: [route] },
    ]), true)
    assert.equal(await h.store.editModelSettings(name, () => [
      { op: 'set', path: ['enabled'], value: true },
    ]), true)
    assert.deepEqual(subagentSelection(current(h.store, name).value), { enabled: true, allowedModels: [route] })
    assert.equal(await h.store.editModelSettings(name, () => [
      { op: 'set', path: ['allowedModels'], value: [] },
    ]), false)
    assert.deepEqual(subagentSelection(current(h.store, name).value), { enabled: true, allowedModels: [route] })
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
