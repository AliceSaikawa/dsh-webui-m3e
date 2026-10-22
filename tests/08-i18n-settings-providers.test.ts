import { test } from 'node:test'
import assert from 'node:assert/strict'
import { messagesOf, untranslatedLocales } from '../web/src/i18n/catalog.ts'
import { customDraft, modelDraft, validateCustom } from '../web/src/features/settings/custom-provider.ts'
import { createCustomProviderStore } from '../web/src/features/settings/custom-provider-store.ts'
import { createKeyDraft } from '../web/src/features/settings/providers.ts'
import { settingsFixtures } from '../web/src/features/settings/mock-fixtures.ts'
import {
  customProviderMessages, modelMessages, providerMessages,
} from '../web/src/features/settings/messages.ts'

const en = {
  provider: messagesOf(providerMessages, 'en'),
  model: messagesOf(modelMessages, 'en'),
  custom: messagesOf(customProviderMessages, 'en'),
}
const zh = {
  provider: messagesOf(providerMessages, 'zh'),
  model: messagesOf(modelMessages, 'zh'),
  custom: messagesOf(customProviderMessages, 'zh'),
}
const ja = {
  provider: messagesOf(providerMessages, 'ja'),
  model: messagesOf(modelMessages, 'ja'),
  custom: messagesOf(customProviderMessages, 'ja'),
}
const ns = () => structuredClone(settingsFixtures().find(row => row.ns === 'llm-pi-ai')!)
const good = (namespace = ns()) => ({ ...customDraft(namespace), id: 'local-api', baseURL: 'http://localhost:4321/v1', models: [modelDraft({ id: 'local-model' })] })

test('提供元・モデル・カスタムプロバイダーの文言は3言語そろっている', () => {
  for (const catalog of [providerMessages, modelMessages, customProviderMessages]) assert.deepEqual(untranslatedLocales(catalog), [])
})

test('提供元の一覧と入力シートの文言は英語と中国語になる', () => {
  assert.equal(en.provider.heading, 'Providers and API keys')
  assert.equal(en.provider.none, 'No providers are registered.')
  assert.equal(en.provider.loading, 'Loading registration status…')
  assert.equal(en.provider.statusRegistered, 'API key: registered')
  assert.equal(en.provider.statusReadOnly(en.provider.statusMissing), 'API key: not registered (cannot be changed)')
  assert.equal(en.provider.keySheetTitle, 'API key')
  assert.equal(en.provider.saved, 'API key saved')
  assert.equal(en.provider.removeConfirm('OpenAI'), 'This removes the key registration for OpenAI. It may also affect other providers that use the same key.')
  assert.equal(en.provider.keyReferenceError('MY_API_KEY', 'another reason', 'my-local'),
    'Reference name “MY_API_KEY”: another reason Leave the key empty, or add the provider with a non-overlapping prefix in the ID (for example, my-local).')
  assert.equal(zh.provider.heading, '提供方与注册状态')
  assert.equal(zh.provider.statusReadOnly(zh.provider.statusMissing), 'API 密钥：未注册（无法更改）')
  assert.equal(zh.provider.saved, 'API 密钥已保存')
})

test('モデルの文言は一覧の状態を英語と中国語で伝える', () => {
  assert.equal(en.model.catalogFailed, 'Could not load the model list. Check the connection.')
  assert.equal(en.model.failureRow('Local', 'timed out'), 'Local: timed out')
  assert.equal(en.model.unknownModel('local-api', 'one'), 'Model not in the list: local-api / one')
  assert.equal(en.model.unknownEffort('fast'), 'Reasoning effort not in the list: fast')
  assert.equal(en.model.resetLabel('Default model'), 'Reset Default model to the default')
  assert.equal(en.model.effortDefault, 'Default (let the model decide)')
  assert.equal(zh.model.unknownModel('local-api', 'one'), '不在列表中的模型：local-api / one')
  assert.equal(zh.model.allowFirst, '请先选择至少一个可使用的模型')
  // The Japanese catalogue keeps the texts the panel showed before.
  assert.equal(ja.model.appliedImmediately, 'すぐ反映されます')
  assert.equal(ja.model.unknownModel('local-api', 'one'), '一覧にないモデル：local-api / one')
})

test('カスタムプロバイダーの入力条件は選んだ言語で返す', () => {
  const row = ns(), choices = ['openai-completions', 'openai-responses', 'anthropic-messages']
  assert.deepEqual(validateCustom(good(row), choices, [], false, undefined, en.custom), {})
  assert.equal(validateCustom({ ...good(row), id: '' }, choices, [], false, undefined, en.custom).id, 'Enter a provider ID.')
  assert.equal(validateCustom({ ...good(row), baseURL: 'not a url' }, choices, [], false, undefined, en.custom).baseURL,
    'Enter a URL starting with http:// or https://.')
  assert.equal(validateCustom({ ...good(row), models: [] }, choices, [], false, undefined, en.custom).models,
    'Add at least one model.')
  assert.equal(validateCustom({ ...good(row), id: '' }, choices, [], false, undefined, zh.custom).id, '请输入提供方 ID。')
  assert.equal(validateCustom({ ...good(row), models: [] }, choices, [], false, undefined, ja.custom).models,
    'モデルを 1 件以上追加してください。')
})

test('保存の失敗は言語のついた文言と、あとで訳せるキーを返す', async () => {
  const text = { keyRequired: 'Enter a key.', saveFailed: 'Could not save the key. Enter it again.' }
  const draft = createKeyDraft(async () => ({ ok: false, code: 'rejected', message: 'refused' }), () => text)
  assert.equal(await draft.submit(), false)
  assert.equal(draft.getSnapshot().error, 'Enter a key.')
  draft.input('secret')
  assert.equal(await draft.submit(), false)
  assert.equal(draft.getSnapshot().error, 'refused')
  assert.doesNotMatch(JSON.stringify(draft.getSnapshot()), /secret/)
  draft.dispose()
})

test('カスタムプロバイダーの保存メッセージは、表示した時点の言語で作る', async () => {
  const namespace = ns()
  let message: string | null = null
  const keys = {
    async load() { return true },
    getSnapshot() {
      return { phase: 'ready' as const, busy: false, error: null,
        rows: [{ id: 'local-api', name: 'local-api', custom: true, ns: 'llm-pi-ai', path: ['providers', 'local-api'], ref: 'LOCAL_API_API_KEY', needsReference: false, status: 'missing' as const, writable: true }] }
    },
    async save() { return { ok: false as const, code: 'rejected' as const, message: 'API キーの変更が拒否されました。登録状況を確認してください。' } },
  }
  const remote = {
    llm: {
      async listProviders() { return { ok: true as const, value: [] } },
      async listConfigurableProviders() { return { ok: true as const, value: [] } },
    },
    settings: {
      async describe() { return { ok: true as const, value: { writable: true, namespaces: [{ ...namespace, value: {} }] } } },
      async mutate(_ns: string, _ops: unknown, revision: number) {
        return { ok: true as const, value: { ...namespace.value, providers: { 'local-api': { api: 'openai-completions', baseURL: 'http://localhost:4321/v1', apiKeyEnv: 'LOCAL_API_API_KEY', models: [{ id: 'one' }] } } }, revision: revision + 1 }
      },
    },
  }
  const store = createCustomProviderStore(remote as never, keys, undefined, undefined,
    async () => ({ configured: false, writable: true }), () => en.custom)
  await store.load()
  store.change(draft => ({ ...draft, id: 'local-api', baseURL: 'http://localhost:4321/v1', models: [modelDraft({ id: 'one' })] }))
  store.input.input('secret')
  assert.equal(await store.submit(), false)
  message = store.getSnapshot().message
  assert.equal(message, 'The provider settings were saved, but the API key could not be saved. API キーの変更が拒否されました。登録状況を確認してください。')
  store.dispose()
})
