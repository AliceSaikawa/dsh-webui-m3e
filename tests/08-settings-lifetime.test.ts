import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { extendMock, type SettingsMockRemote } from '../web/src/features/settings/mock.ts'
import { settingsStoreFor } from '../web/src/features/settings/settings-lifetime.ts'

const ns = 'example-extension'
const tick = () => new Promise<void>(resolve => setImmediate(resolve))

function harness() {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  const remote = ctx.remote.settings as SettingsMockRemote
  let describes = 0
  const describe = remote.describe.bind(remote)
  remote.describe = () => { describes++; return describe() }
  const lifetime = settingsStoreFor(ctx.remote, ctx.connection)
  return { ctx, remote, lifetime, describes: () => describes }
}

test('#126 設定画面を開くたびに store を読み直す', async t => {
  const h = harness(); t.after(() => h.ctx.dispose())
  assert.equal(await h.lifetime.store.reload(), true)
  const before = h.describes()
  h.lifetime.opened()
  await tick()
  assert.equal(h.describes(), before + 1)
  assert.equal(h.lifetime.store.getSnapshot().phase, 'ready')
})

test('#126 画面を閉じている間の切断と再接続を store が受け取り、入力の中断を解く', async t => {
  const h = harness(); t.after(() => h.ctx.dispose())
  assert.equal(await h.lifetime.store.reload(), true)
  const input = h.lifetime.store.input(ns, ['timeout'])
  input.change('80')

  h.ctx.mock.setConnectionState('disconnected')
  assert.equal(h.lifetime.store.getSnapshot().writable, false)
  assert.equal(input.getSnapshot().saving, false)
  assert.match(input.getSnapshot().notice!, /保存を中断/)

  h.ctx.mock.setConnectionState('connected')
  assert.equal(await h.lifetime.store.reload(), true)
  assert.equal(h.lifetime.store.getSnapshot().writable, true)
  await input.retry()
  const row = h.lifetime.store.getSnapshot().namespaces.find(item => item.ns === ns)
  assert.ok(row)
  assert.equal(row.value.timeout, 80)
  assert.equal(input.getSnapshot().dirty, false)
})

test('#126 画面を閉じている間の設定変更通知も store が読み直す', async t => {
  const h = harness(); t.after(() => h.ctx.dispose())
  assert.equal(await h.lifetime.store.reload(), true)
  const row = h.lifetime.store.getSnapshot().namespaces.find(item => item.ns === ns)
  assert.ok(row)
  assert.equal((await h.remote.update(ns, { timeout: 90 }, row.revision)).ok, true)
  for (let i = 0; i < 10; i++) await tick()
  const updated = h.lifetime.store.getSnapshot().namespaces.find(item => item.ns === ns)
  assert.ok(updated)
  assert.equal(updated.value.timeout, 90)
  assert.equal(updated.revision, row.revision + 1)
})
