import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { extendMock, type SettingsMockRemote } from '../web/src/features/settings/mock.ts'
import { createSettingsStore, fieldKey, type SettingsApi } from '../web/src/features/settings/store.ts'

const ns = 'example-extension'
const tick = () => new Promise<void>(resolve => setImmediate(resolve))
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function harness() {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  const remote = ctx.remote.settings as SettingsMockRemote
  const calls: unknown[] = []
  const api: SettingsApi = {
    describe: () => remote.describe(),
    update: (name, patch, revision) => { calls.push({ patch, revision }); return remote.update(name, patch, revision) },
    mutate: (name, ops, revision) => { calls.push({ ops, revision }); return remote.mutate(name, ops, revision) },
  }
  const store = createSettingsStore(api)
  return { ctx, remote, api, store, calls, row: () => store.getSnapshot().namespaces.find(row => row.ns === ns)! }
}

test('#46 まとまりの復帰で子の古い編集だけを破棄し、兄弟の待機入力を保存する', async t => {
  const h = harness(); t.after(() => h.ctx.dispose())
  await h.store.reload()
  const gate = deferred<void>()
  const mutate = h.api.mutate
  h.api.mutate = async (...args) => { await gate.promise; return mutate(...args) }
  const reset = h.store.edit(ns, ['retry'])
  const child = h.store.edit(ns, ['retry', 'interval'], 9)
  const sibling = h.store.edit(ns, ['timeout'], 80)
  await tick()
  gate.resolve()
  assert.deepEqual(await Promise.all([reset, child, sibling]), [true, false, true])
  assert.equal(h.row().value.timeout, 80)
})

test('#46 保存拒否のエラーは外部revisionの読み直しで消える', async t => {
  const h = harness(); t.after(() => h.ctx.dispose())
  await h.store.reload()
  h.api.update = async () => ({ ok: false, error: { code: 'settings/rejected', message: '保存を拒否しました', details: {} } })
  assert.equal(await h.store.edit(ns, ['timeout'], 80), false)
  assert.ok(h.store.getSnapshot().fieldErrors[fieldKey(ns, ['timeout'])])
  await h.remote.update(ns, { timeout: 90 }, h.row().revision)
  await h.store.reload()
  assert.equal(h.row().value.timeout, 90)
  assert.equal(h.store.getSnapshot().fieldErrors[fieldKey(ns, ['timeout'])], undefined)
})

test('#46 60の保存中に80を入力して別のまとまりを戻しても80を保存する', async t => {
  const h = harness(); t.after(() => h.ctx.dispose())
  await h.store.connectionChanged('connected')
  const input = h.store.input(ns, ['timeout'])
  const gate = deferred<void>()
  const update = h.api.update
  h.api.update = async (...args) => { if (args[1].timeout === 60) await gate.promise; return update(...args) }
  input.change('60')
  const first = input.flush()
  await tick()
  input.change('80')
  const reset = h.store.edit(ns, ['retry'])
  gate.resolve()
  await Promise.all([first, reset])
  assert.equal(h.row().value.timeout, 80)
  assert.equal(input.getSnapshot().value, '80')
  assert.equal(input.getSnapshot().dirty, false)
  assert.deepEqual(h.calls.map(call => (call as { patch?: unknown }).patch ?? 'reset'), [{ timeout: 60 }, 'reset', { timeout: 80 }])
})

test('#46 同じまとまりの未送信入力は復帰後に古い値を送り直さない', async t => {
  const h = harness(); t.after(() => h.ctx.dispose())
  await h.store.reload()
  const child = h.store.input(ns, ['retry', 'interval'])
  child.changeDeferred('99')
  await h.store.edit(ns, ['retry'])
  await child.flush()
  assert.equal(child.getSnapshot().dirty, false)
  assert.equal(h.calls.length, 1)
  assert.notEqual(child.getSnapshot().value, '99')
})

test('#46 まとまりの復帰開始後は子だけ編集を止め、完了後に再び編集できる', async t => {
  const h = harness(); t.after(() => h.ctx.dispose())
  await h.store.reload()
  const child = h.store.input(ns, ['retry', 'interval'])
  const sibling = h.store.input(ns, ['timeout'])
  const old = child.getSnapshot().value
  const gate = deferred<void>()
  const mutate = h.api.mutate
  h.api.mutate = async (...args) => { await gate.promise; return mutate(...args) }
  const reset = h.store.edit(ns, ['retry'])
  assert.equal(h.store.isResetting(ns, ['retry', 'interval']), true)
  assert.equal(h.store.isResetting(ns, ['timeout']), false)
  child.changeDeferred('9')
  assert.equal(child.getSnapshot().value, old)
  sibling.change('80')
  gate.resolve(); await reset
  assert.equal(h.store.isResetting(ns, ['retry', 'interval']), false)
  child.change('7'); await child.flush(); await sibling.flush()
  assert.equal(child.getSnapshot().value, '7')
  assert.equal(h.row().value.timeout, 80)
})

test('#46 debounce中の切断は入力を保ち、復帰後の明示した再試行だけで保存する', async t => {
  const h = harness(); t.after(() => h.ctx.dispose())
  await h.store.connectionChanged('connected')
  const input = h.store.input(ns, ['timeout'])
  input.changeDeferred('80')
  await h.store.connectionChanged('disconnected')
  assert.equal(input.getSnapshot().value, '80')
  assert.match(input.getSnapshot().notice!, /保存を中断/)
  await input.retry()
  assert.match(input.getSnapshot().notice!, /保存を中断/)
  input.setActive(false)
  const remounted = h.store.input(ns, ['timeout'])
  assert.equal(remounted, input)
  remounted.setActive(true)
  await h.store.connectionChanged('connected')
  await input.flush()
  assert.equal(h.calls.length, 0)
  await input.retry()
  assert.equal(h.row().value.timeout, 80)
  assert.equal(input.getSnapshot().notice, undefined)
})

test('#46 切断前のグループ復帰の終了が新しい接続の復帰中状態を解除しない', async t => {
  const h = harness(); t.after(() => h.ctx.dispose())
  await h.store.connectionChanged('connected')
  const oldGate = deferred<void>(), newGate = deferred<void>()
  const mutate = h.api.mutate
  let calls = 0
  h.api.mutate = async (...args) => {
    if (++calls === 1) {
      await oldGate.promise
      return { ok: false, error: { code: 'settings/rejected', message: '古い復帰', details: {} } }
    }
    await newGate.promise
    return mutate(...args)
  }
  const old = h.store.edit(ns, ['retry']); await tick()
  await h.store.connectionChanged('disconnected')
  assert.equal(h.store.isResetting(ns, ['retry', 'interval']), false)
  await h.store.connectionChanged('connected')
  const fresh = h.store.edit(ns, ['retry']); await tick()
  oldGate.resolve(); await old
  assert.equal(h.store.isResetting(ns, ['retry', 'interval']), true)
  newGate.resolve(); await fresh
  assert.equal(h.store.isResetting(ns, ['retry', 'interval']), false)
})

for (const outcome of ['late-success', 'late-failure', 'never-settles'] as const) {
  test('#46 保存中断後の ' + outcome + ' は復帰後の入力や再試行を妨げない', async t => {
    const h = harness(); t.after(() => h.ctx.dispose())
    await h.store.connectionChanged('connected')
    const input = h.store.input(ns, ['timeout'])
    const gate = deferred<Awaited<ReturnType<SettingsApi['update']>>>()
    const update = h.api.update
    h.api.update = () => gate.promise
    input.change('60')
    const old = input.flush()
    await tick()
    input.change('80')
    await h.store.connectionChanged('disconnected')
    h.api.update = update
    await h.store.connectionChanged('connected')
    await input.retry()
    assert.equal(h.row().value.timeout, 80)
    if (outcome !== 'never-settles') {
      gate.resolve(outcome === 'late-success' ? { ok: true, value: { ...h.row(), revision: 99, value: { ...h.row().value, timeout: 60 } } }
        : { ok: false, error: { code: 'settings/rejected', message: '古い拒否', details: {} } })
      await old
    }
    assert.equal(h.row().value.timeout, 80)
    assert.equal(input.getSnapshot().value, '80')
    assert.equal(input.getSnapshot().dirty, false)
    assert.equal(input.getSnapshot().saving, false)
    assert.deepEqual(h.store.getSnapshot().fieldErrors, {})
  })
}

test('#46 中断した変更が実際には保存済みなら復帰時に照合し再送しない', async t => {
  const h = harness(); t.after(() => h.ctx.dispose())
  await h.store.connectionChanged('connected')
  const input = h.store.input(ns, ['timeout'])
  const gate = deferred<void>()
  const update = h.api.update
  h.api.update = async (...args) => { const result = await update(...args); await gate.promise; return result }
  input.change('80')
  const old = input.flush()
  await tick()
  await h.store.connectionChanged('disconnected')
  await h.store.connectionChanged('connected')
  assert.equal(input.getSnapshot().notice, undefined)
  assert.equal(input.getSnapshot().dirty, false)
  assert.equal(input.getSnapshot().saved, true)
  gate.resolve()
  await old
  assert.equal(h.calls.length, 1)
})

test('#46 入力変更と元の値への復帰は拒否された入力のエラーを消す', async t => {
  const h = harness(); t.after(() => h.ctx.dispose())
  await h.store.reload()
  const input = h.store.input(ns, ['timeout'])
  const original = input.getSnapshot().value
  h.api.update = async () => ({ ok: false, error: { code: 'settings/rejected', message: '保存を拒否しました', details: {} } })
  input.change('80'); await input.flush()
  assert.ok(h.store.getSnapshot().fieldErrors[fieldKey(ns, ['timeout'])])
  input.change(original)
  assert.equal(input.getSnapshot().dirty, false)
  assert.deepEqual(h.store.getSnapshot().fieldErrors, {})
})

test('#46 古い入力の拒否応答は新しい入力のエラーとして表示しない', async t => {
  const h = harness(); t.after(() => h.ctx.dispose())
  await h.store.reload()
  const input = h.store.input(ns, ['timeout'])
  const gate = deferred<void>()
  const update = h.api.update
  h.api.update = async (...args) => {
    if (args[1].timeout === 60) { await gate.promise; return { ok: false, error: { code: 'settings/rejected', message: '古い入力の拒否', details: {} } } }
    return update(...args)
  }
  input.change('60'); const saving = input.flush(); await tick()
  input.change('80'); gate.resolve(); await saving
  assert.equal(h.row().value.timeout, 80)
  assert.deepEqual(h.store.getSnapshot().fieldErrors, {})
})

test('#46 外部更新時は未保存の入力を保って止め、最新revisionで再試行する', async t => {
  const h = harness(); t.after(() => h.ctx.dispose())
  await h.store.reload()
  const input = h.store.input(ns, ['timeout'])
  input.changeDeferred('80')
  await h.remote.update(ns, { timeout: 90 }, h.row().revision)
  await h.store.reload()
  assert.equal(input.getSnapshot().value, '80')
  assert.match(input.getSnapshot().notice!, /ほかの場所/)
  await input.flush()
  assert.equal(h.calls.length, 0)
  await input.retry()
  assert.equal(h.row().value.timeout, 80)
  assert.deepEqual(h.calls, [{ patch: { timeout: 80 }, revision: 1 }])
})
