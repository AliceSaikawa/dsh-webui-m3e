import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { extendMock as composer } from '../web/src/features/composer/mock.ts'
import { extendMock as settings, type SettingsMockRemote } from '../web/src/features/settings/mock.ts'
import { composerApi } from '../web/src/features/composer/api.ts'
import type { ProviderRemote } from '../web/src/features/settings/providers.ts'
import { unwrapRemoteResult } from '../web/src/dsh/remote-result.ts'
import { onRemoteEvent } from '../web/src/dsh/remote-events.ts'
import { registerMockModelWriter } from '../web/src/features/settings/mock-models.ts'
import type { ModelSelection } from '../web/src/features/composer/api.ts'

const setup = (scenario?: string) => createMockContext({ extensions: [{ extendMock: composer }, { extendMock: settings }], scenario })
async function drain() { for (let i = 0; i < 20; i++) await Promise.resolve() }

test('M5 設定から提供元・モデル・選択の候補を一緒に更新し、削除した候補を拒否する', async () => {
  const ctx = setup()
  try {
    const api = ctx.remote.settings as SettingsMockRemote
    const llm = (ctx.remote as unknown as ProviderRemote).llm
    const models = composerApi(ctx.remote)
    const initial = await models.modelCatalog()
    const config = unwrapRemoteResult(await api.describe()).namespaces.find(row => row.ns === 'llm-deepseek')!
    assert.deepEqual(initial.groups.find(p => p.id === 'deepseek')?.models.map(m => ({ id: m.id, name: m.name })), config.value.models)
    assert.deepEqual(new Set(initial.routableProviders), new Set(unwrapRemoteResult(await llm.listProviders()).map(p => p.id)))
    let events = 0
    const off = onRemoteEvent(ctx.remote, 'llm/adapters-updated', () => { events++ })
    const patch = { providers: { audit: { displayName: '監査用', api: 'openai-completions', baseURL: 'http://localhost:1234/v1', models: [{ id: 'audit-model', name: '監査モデル' }] } } }
    const saved = unwrapRemoteResult(await api.update('llm-pi-ai', patch))
    assert.equal(events, 1)
    assert.deepEqual(unwrapRemoteResult(await llm.listProviders()).find(p => p.id === 'audit'), { id: 'audit', name: '監査用' })
    assert.deepEqual(unwrapRemoteResult(await llm.listConfigurableProviders()).find(p => p.provider === 'audit'), {
      provider: 'audit', displayName: '監査用', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'audit'], declared: true,
    })
    assert.equal((await models.modelCatalog()).groups.find(p => p.id === 'audit')?.models[0]?.id, 'audit-model')
    assert.equal((await models.selectModel('approval-sheet', { provider: 'audit', model: 'audit-model' })).model, 'audit-model')
    assert.equal((await api.update('llm-pi-ai', patch, saved.revision)).ok, true)
    assert.equal(events, 1)
    assert.equal((await api.mutate('llm-pi-ai', [{ op: 'unset', path: ['providers', 'audit'] }])).ok, true)
    assert.equal(events, 2)
    assert.equal(unwrapRemoteResult(await llm.listProviders()).some(p => p.id === 'audit'), false)
    assert.equal(unwrapRemoteResult(await llm.listConfigurableProviders()).some(p => p.provider === 'audit'), false)
    assert.equal((await models.modelCatalog()).groups.some(p => p.id === 'audit'), false)
    await assert.rejects(models.selectModel('approval-sheet', { provider: 'audit', model: 'audit-model' }))
    unwrapRemoteResult(await api.update('llm-deepseek', { models: [{ id: 'replaced', name: '置換後' }] }))
    assert.deepEqual((await models.modelCatalog()).groups.find(p => p.id === 'deepseek')?.models.map(m => m.id), ['replaced'])
    await assert.rejects(models.selectModel('approval-sheet', initial.default))
    off()
  } finally { ctx.dispose() }
})

test('M6 モデル選択は既定値を保存し、推論なしへの変更で古い強さを消す', async () => {
  const ctx = setup()
  try {
    const models = composerApi(ctx.remote)
    const selected = await models.selectModel('approval-sheet', { provider: 'ollama', model: 'local' })
    await drain()
    const row = unwrapRemoteResult(await (ctx.remote.settings as SettingsMockRemote).describe()).namespaces.find(row => row.ns === 'agent-default-model')!
    assert.deepEqual(row.value, selected)
    assert.deepEqual(row.user, selected)
    assert.deepEqual((await models.modelCatalog()).default, selected)
    assert.deepEqual(ctx.mock.getSettingsValue('agent-default-model'), selected)
  } finally { ctx.dispose() }
})

test('M6 既定値を保存できなくても会話のモデル選択は成功する', async () => {
  const ctx = setup('settings-readonly')
  try {
    const models = composerApi(ctx.remote)
    const before = (await models.modelCatalog()).default
    const selected = await models.selectModel('approval-sheet', { provider: 'ollama', model: 'local' })
    await drain()
    assert.deepEqual(ctx.mock.getProjection<any>('approval-sheet', 'modelSelection').next, selected)
    assert.deepEqual((await models.modelCatalog()).default, before)
  } finally { ctx.dispose() }
})

test('M6 遅い既定値保存は選択RPCを待たせず、次の保存だけを直列に待たせる', async () => {
  const ctx = setup()
  let finish!: () => void
  const firstSave = new Promise<void>(resolve => { finish = resolve })
  const calls: ModelSelection[] = []
  registerMockModelWriter(ctx.mock, async selection => {
    calls.push(selection)
    if (calls.length === 1) await firstSave
  })
  try {
    const api = composerApi(ctx.remote)
    const first = await api.selectModel('approval-sheet', { provider: 'ollama', model: 'local' })
    const second = await api.selectModel('approval-sheet', { provider: 'deepseek', model: 'deepseek-v4' })
    await drain()
    assert.deepEqual(calls, [first])
    assert.deepEqual(ctx.mock.getProjection<any>('approval-sheet', 'modelSelection').next, second)
    finish()
    await drain()
    assert.deepEqual(calls, [first, second])
  } finally { finish(); ctx.dispose() }
})
