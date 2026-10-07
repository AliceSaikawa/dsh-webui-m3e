import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync } from 'node:fs'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { extendMock as composer, mockModelCatalog } from '../web/src/features/composer/mock.ts'
import { extendMock as settings, type SettingsMockRemote } from '../web/src/features/settings/mock.ts'
import { chooseModel, modelResetOperations, modelSaveOperations, savedModel, withReasoningEffort } from '../web/src/features/settings/model-settings.ts'
import { modelChoices } from '../web/src/features/composer/model-picker.ts'
import { composerApi } from '../web/src/features/composer/api.ts'
import { unwrapRemoteResult } from '../web/src/dsh/remote-result.ts'
import type { SettingValue } from '../web/src/features/settings/schema.ts'

const choices = modelChoices(mockModelCatalog)
const local = choices.find(item => item.model.id === 'local')!
const deepseek = choices.find(item => item.model.id === 'deepseek-v4')!

test('下位の high を指定なしで覆い、再読込とモデルカタログにも指定なしを反映する', async () => {
  const ctx = createMockContext({ scenario: 'settings-inherited-reasoning', extensions: [{ extendMock: composer }, { extendMock: settings }] })
  try {
    const api = ctx.remote.settings as SettingsMockRemote
    const describe = async () => unwrapRemoteResult(await api.describe()).namespaces.find(row => row.ns === 'agent-default-model')!
    assert.equal((await describe()).value.reasoningEffort, 'high')
    for (const selection of [chooseModel(local), withReasoningEffort(chooseModel(deepseek), '')]) {
      const before = await describe()
      const row = unwrapRemoteResult(await api.mutate(before.ns, modelSaveOperations(selection), before.revision))
      assert.deepEqual(row.value, selection)
      assert.deepEqual(savedModel((await describe()).value), selection)
      assert.deepEqual((await composerApi(ctx.remote).modelCatalog()).default, selection)
      assert.deepEqual(row.user?.reasoningEffort, { __jsExpr: 'void 0' })
      assert.equal(row.base?.reasoningEffort, 'high', '下位設定は保持する')
    }
    const beforeReset = await describe()
    const reset = unwrapRemoteResult(await api.mutate(beforeReset.ns, modelResetOperations, beforeReset.revision))
    assert.equal(reset.value.reasoningEffort, 'high', '既定値に戻すと下位設定を継承する')
    assert.deepEqual(reset.user, {})
    assert.deepEqual(savedModel(reset.value), chooseModel(deepseek))
  } finally { ctx.dispose() }
})

test('固定の指定なし設定式だけを偽RPCが受け付け、任意の式や型違いは拒否する', async () => {
  const ctx = createMockContext({ extensions: [{ extendMock: composer }, { extendMock: settings }] })
  try {
    const api = ctx.remote.settings as SettingsMockRemote
    const values: SettingValue[] = [null, '', { __jsExpr: 'unexpected()' }, { __jsExpr: 'void 0', extra: true }]
    for (const value of values) {
      const result = await api.mutate('agent-default-model', [{ op: 'set', path: ['reasoningEffort'], value }])
      // Empty strings remain strings in the schema; they are never used as the clear operation.
      assert.equal(result.ok, value === '')
    }
  } finally { ctx.dispose() }
})

// Optional contract check against the already installed rc.2 distribution.
// Imports public code only; no host, adapter, configuration file or DSH process is started.
const nativeRoot = ['../tmp/dsh-integration/dsh-0.2.0-rc.2/node_modules/@deepseek-ai/',
  '../../dsh-webui-m3e/tmp/dsh-integration/dsh-0.2.0-rc.2/node_modules/@deepseek-ai/']
  .map(path => new URL(path, import.meta.url))
  .find(root => existsSync(new URL('dsh-agent-default-model/lib/index.js', root)))

test('DSH rc.2 の mutate・設定解決・モデル検証で継承と指定なしを区別する', {
  skip: nativeRoot ? false : 'DSH 0.2.0-rc.2 の公開配布コードが未配置',
}, async () => {
  const { AgentDefaultModelConfig } = await import(new URL('dsh-agent-default-model/lib/index.js', nativeRoot).href)
  const { SettingsForms } = await import(new URL('dsh-settings/lib/index.js', nativeRoot).href)
  const { interpolate } = await import(new URL('cordis-plugin-loader/lib/index.js', nativeRoot).href)
  const { LlmRuntime } = await import(new URL('dsh-llm/lib/index.js', nativeRoot).href)
  const inherited = { provider: 'deepseek', model: 'deepseek-v4', reasoningEffort: 'high' }
  const schema = AgentDefaultModelConfig.Config
  async function resolve(operations: ReturnType<typeof modelSaveOperations>) {
    let raw: Record<string, unknown> = {}
    await SettingsForms.prototype.mutate.call({
      async write(_ns: string, change: (raw: object, base: object, schema: unknown) => Record<string, unknown>) {
        raw = change({}, inherited, schema)
      },
    }, 'agent-default-model', operations)
    const config = schema(interpolate({}, { ...inherited, ...raw }))
    return AgentDefaultModelConfig.prototype.currentSelection.call({ config })
  }
  const validate = (selection: object, info: object = { id: 'local' }) =>
    LlmRuntime.prototype.resolveCallWithInfo.call({}, selection, info).config
  const legacy = await resolve([
    ...modelSaveOperations(chooseModel(local)).slice(0, 2), { op: 'unset', path: ['reasoningEffort'] },
  ])
  assert.equal(legacy.reasoningEffort, 'high')
  assert.throws(() => validate(legacy), { code: 'UNSUPPORTED_REASONING_EFFORT' })
  const cleared = await resolve(modelSaveOperations(chooseModel(local)))
  assert.deepEqual(cleared, { provider: 'ollama', model: 'local' })
  assert.deepEqual(validate(cleared), cleared)
  const defaulted = await resolve(modelSaveOperations(withReasoningEffort(chooseModel(deepseek), '')))
  assert.equal(validate(defaulted, { id: 'deepseek-v4', reasoning: {
    efforts: [{ id: 'low' }, { id: 'high' }], defaultEffort: 'low',
  } }).reasoningEffort, 'low')
  assert.equal((await resolve(modelResetOperations)).reasoningEffort, 'high')
})
