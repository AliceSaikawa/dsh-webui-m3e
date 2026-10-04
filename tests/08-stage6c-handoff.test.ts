/** Integration checks for the settings RPC wiring, including the former handoff. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { extendMock as settings, type SettingsMockRemote } from '../web/src/features/settings/mock.ts'
import { extendMock as composer } from '../web/src/features/composer/mock.ts'
import { composerApi } from '../web/src/features/composer/api.ts'
import { unwrapRemoteResult } from '../web/src/dsh/remote-result.ts'
import { onRemoteEvent } from '../web/src/dsh/remote-events.ts'

test('handoff M3 実際の設定remoteへ配列の変更処理が接続されている', async () => {
  const ctx = createMockContext({ extensions: [{ extendMock: composer }, { extendMock: settings }] })
  try {
    const api = ctx.remote.settings as SettingsMockRemote
    const ns = 'subagent-model-selection-settings'
    const row = unwrapRemoteResult(await api.describe()).namespaces.find(row => row.ns === ns)!
    const saved = unwrapRemoteResult(await api.update(ns, { allowedModels: [{ provider: 'p', model: 'a' }, { provider: 'p', model: 'b' }] }, row.revision))
    const changed = unwrapRemoteResult(await api.mutate(ns, [{ op: 'set', path: ['allowedModels', '0', 'model'], value: 'changed' }, { op: 'unset', path: ['allowedModels', '1'] }], saved.revision))
    assert.deepEqual(changed.value.allowedModels, [{ provider: 'p', model: 'changed' }])
  } finally { ctx.dispose() }
})

test('handoff M11 無変更保存の通知とrevisionを増やさず省略revisionを受け入れる', async () => {
  const ctx = createMockContext({ extensions: [{ extendMock: settings }] })
  try {
    const api = ctx.remote.settings as SettingsMockRemote
    const row = unwrapRemoteResult(await api.describe()).namespaces.find(row => row.ns === 'bash-sandbox')!
    const first = unwrapRemoteResult(await api.update(row.ns, { timeoutMs: 61000 }, row.revision))
    let events = 0
    const off = onRemoteEvent(ctx.remote, 'settings/document-updated', () => { events++ })
    await Promise.resolve()
    events = 0
    const same = unwrapRemoteResult(await api.update(row.ns, { timeoutMs: 61000 }, first.revision))
    assert.equal(same.revision, first.revision)
    assert.equal(events, 0)
    const optional = api.update as (ns: string, patch: { timeoutMs: number }, revision?: number) => ReturnType<SettingsMockRemote['update']>
    assert.equal((await optional(row.ns, { timeoutMs: 62000 })).ok, true)
    off()
  } finally { ctx.dispose() }
})

test('handoff M7 W09相当の設定保存後は権限カタログも失敗する', async () => {
  const ctx = createMockContext({ extensions: [{ extendMock: composer }, { extendMock: settings }] })
  try {
    const api = ctx.remote.settings as SettingsMockRemote
    const row = unwrapRemoteResult(await api.describe()).namespaces.find(row => row.ns === 'permission')!
    assert.equal((await api.update(row.ns, { defaultPreset: 'unknown-preset' }, row.revision)).ok, true)
    await assert.rejects(composerApi(ctx.remote).permissionCatalog())
  } finally { ctx.dispose() }
})
