import assert from 'node:assert/strict'
import test from 'node:test'
import { settingsFixtures } from '../web/src/features/settings/mock-fixtures.ts'
import { decodeSchema, groupNamespaces, schemaFields } from '../web/src/features/settings/schema.ts'
import { validMockOperations, validMockPatch, validMockValue } from '../web/src/features/settings/mock-validation.ts'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { extendMock, type SettingsMockRemote } from '../web/src/features/settings/mock.ts'
import { unwrapRemoteResult } from '../web/src/dsh/remote-result.ts'

const row = (ns: string) => settingsFixtures().find(row => row.ns === ns)!

test('公開fixtureは実在する設定のパスだけを定義し架空のフォームを独立させる', () => {
  const keys = (ns: string) => Object.keys(decodeSchema(row(ns).schema).dict ?? {})
  assert.deepEqual(keys('permission'), ['defaultPreset'])
  assert.deepEqual(keys('agent-loop'), ['maxParallelToolCalls'])
  assert.deepEqual(keys('agent-preset-registry'), ['selectedDefault'])
  assert.deepEqual(keys('locale'), ['preference'])
  assert.deepEqual(keys('bash-sandbox'), ['cwd', 'timeoutMs', 'maxTimeoutMs', 'maxOutputBytes', 'maxSpillBytes', 'graceMs'])
  assert.deepEqual(keys('subagent-model-selection-settings'), ['enabled', 'allowedModels'])
  assert.deepEqual(keys('llm-pi-ai'), ['providers'])
  assert.equal(keys('llm-deepseek').includes('timeout'), false)
  assert.equal(keys('web-search-deepseek').includes('enabled'), false)
  assert.deepEqual(row('bash-sandbox').value, { timeoutMs: 60000, maxTimeoutMs: 600000, maxOutputBytes: 64000, maxSpillBytes: 67108864, graceMs: 3000 })
  assert.deepEqual(row('permission').value, {})
  const fields = schemaFields(row('example-extension'))
  assert.deepEqual(new Set(fields.map(field => field.kind)), new Set(['switch', 'text', 'number', 'select', 'group', 'readonly', 'masked']))
  const grouped = groupNamespaces(settingsFixtures())
  assert.equal(grouped.providers.length, 0)
  assert.deepEqual(grouped.other.map(row => row.ns), ['example-extension'])
  const first = row('bash-sandbox')
  first.value.timeoutMs = 1
  assert.equal(row('bash-sandbox').value.timeoutMs, 60000)
})

test('公開fixtureの検査は実在パスの成功と非公開パス・型・制約の拒否を分ける', () => {
  assert.equal(validMockPatch(row('bash-sandbox'), { timeoutMs: 61000 }), true)
  assert.equal(validMockPatch(row('permission'), { timeout: 60 }), false)
  assert.equal(validMockOperations(row('permission'), [{ op: 'set', path: ['timeout'], value: 60 }]), false)
  assert.equal(validMockPatch(row('agent-loop'), { maxParallelToolCalls: 2 }), true)
  assert.equal(validMockPatch(row('agent-loop'), { maxParallelToolCalls: 0 }), false)
  assert.equal(validMockPatch(row('agent-loop'), { maxParallelToolCalls: 1.5 }), false)
  assert.equal(validMockPatch(row('locale'), { preference: 'ja-JP' }), true)
  assert.equal(validMockPatch(row('locale'), { preference: 'not a locale' }), false)
  assert.equal(validMockPatch(row('subagent-model-selection-settings'), { allowedModels: [{ provider: 'deepseek', model: 'deepseek-v4' }] }), true)
  assert.equal(validMockPatch(row('subagent-model-selection-settings'), { allowedModels: [{}] }), false)
  assert.equal(validMockPatch(row('subagent-model-selection-settings'), { allowedModels: [{ provider: '', model: 'x' }] }), false)
  assert.equal(validMockPatch(row('llm-pi-ai'), { providers: { cloud: { unknown: true } } }), false)
  assert.equal(validMockPatch(row('llm-deepseek'), { thinking: 'unsupported' }), false)
  assert.equal(validMockPatch(row('web-search-deepseek'), { maxUses: 0 }), false)
  for (const fixture of settingsFixtures()) assert.equal(validMockValue(fixture, fixture.value), true, fixture.ns)
  const llm = row('llm-deepseek')
  assert.equal(validMockValue(llm, { ...llm.value, retryPolicy: { maxRetries: 3 } }), false)
  assert.equal(validMockValue(llm, { ...llm.value, retryPolicy: { mode: 'normal', maxRetries: 3 } }), true)
})

test('偽RPCは実物と同じくpermissionの架空項目を拒否しbashの公開項目を保存する', async () => {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  try {
    const api = ctx.remote.settings as SettingsMockRemote
    const description = unwrapRemoteResult(await api.describe())
    const permission = description.namespaces.find(row => row.ns === 'permission')!
    const shell = description.namespaces.find(row => row.ns === 'bash-sandbox')!
    for (const response of [await api.update(permission.ns, { timeout: 60 }, permission.revision), await api.mutate(permission.ns, [{ op: 'set', path: ['timeout'], value: 60 }], permission.revision)]) {
      assert.equal(response.ok, false)
      if (!response.ok) assert.equal(response.error.code, 'settings/rejected')
    }
    const saved = unwrapRemoteResult(await api.update(shell.ns, { timeoutMs: 61000 }, shell.revision))
    assert.equal(saved.value.timeoutMs, 61000)
    const reset = unwrapRemoteResult(await api.mutate(shell.ns, [{ op: 'unset', path: ['timeoutMs'] }], saved.revision))
    assert.equal(reset.value.timeoutMs, 60000)
  } finally { ctx.dispose() }
})
