import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { extendMock, type SettingsMockRemote } from '../web/src/features/settings/mock.ts'
import { unwrapRemoteResult } from '../web/src/dsh/remote-result.ts'

test('M3 配列への複数操作は最後の値を検証し、中間の未完成な値を許可する', async () => {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  try {
    const api = ctx.remote.settings as SettingsMockRemote
    const ns = 'subagent-model-selection-settings'
    const before = unwrapRemoteResult(await api.update(ns, { allowedModels: [] }))
    const saved = unwrapRemoteResult(await api.mutate(ns, [
      { op: 'set', path: ['allowedModels', '0'], value: { provider: 'p' } },
      { op: 'set', path: ['allowedModels', '0', 'model'], value: 'a' },
    ], before.revision))
    assert.deepEqual(saved.value.allowedModels, [{ provider: 'p', model: 'a' }])
    const rejected = await api.mutate(ns, [
      { op: 'set', path: ['allowedModels', '0'], value: { provider: 'p', model: 'a' } },
      { op: 'unset', path: ['allowedModels', '0', 'model'] },
    ], saved.revision)
    assert.equal(rejected.ok, false)
    assert.deepEqual(unwrapRemoteResult(await api.describe()).namespaces.find(row => row.ns === ns), saved)
  } finally { ctx.dispose() }
})
