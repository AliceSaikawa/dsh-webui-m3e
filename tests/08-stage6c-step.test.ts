import assert from 'node:assert/strict'
import test from 'node:test'
import { parseFieldInput, schemaFields } from '../web/src/features/settings/schema.ts'
import { settingsFixtures } from '../web/src/features/settings/mock-fixtures.ts'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { extendMock, type SettingsMockRemote } from '../web/src/features/settings/mock.ts'
import { unwrapRemoteResult } from '../web/src/dsh/remote-result.ts'

test('B1 整数に近い小数を画面で拒否し既存の刻みエラーを返す', () => {
  const row = settingsFixtures().find(row => row.ns === 'agent-loop')!
  const field = schemaFields(row)[0]!
  assert.deepEqual(parseFieldInput(field, '1.000000001'), { ok: false, message: '1 刻みで入力してください。' })
  assert.deepEqual(parseFieldInput(field, '2'), { ok: true, value: 2 })
})

test('B1 整数に近い小数を偽RPCのupdateとmutateも拒否する', async () => {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  try {
    const api = ctx.remote.settings as SettingsMockRemote
    const row = unwrapRemoteResult(await api.describe()).namespaces.find(row => row.ns === 'agent-loop')!
    for (const result of [await api.update(row.ns, { maxParallelToolCalls: 1.000000001 }, row.revision),
      await api.mutate(row.ns, [{ op: 'set', path: ['maxParallelToolCalls'], value: 1.000000001 }], row.revision)]) {
      assert.equal(result.ok, false)
      if (!result.ok) assert.equal(result.error.code, 'settings/rejected')
    }
    assert.deepEqual(unwrapRemoteResult(await api.describe()).namespaces.find(item => item.ns === row.ns), row)
  } finally { ctx.dispose() }
})
