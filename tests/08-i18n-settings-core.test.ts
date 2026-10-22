import { test } from 'node:test'
import assert from 'node:assert/strict'
import { messagesOf, untranslatedLocales } from '../web/src/i18n/catalog.ts'
import { presetDisplayText } from '../web/src/features/settings/agent-presets.ts'
import { displayableRejection } from '../web/src/features/settings/store.ts'
import {
  pageSummary, parseFieldInput, providerSummary, schemaFields, settingsPageTitle,
  type SettingField, type SettingObject, type SettingsNamespace,
} from '../web/src/features/settings/schema.ts'
import { settingsSchemaMessages } from '../web/src/features/settings/messages.ts'
import { agentPresetMessages } from '../web/src/features/settings/messages.ts'
import { settingsScreenMessages } from '../web/src/features/settings/messages.ts'
import { settingsFieldMessages } from '../web/src/features/settings/messages.ts'
import { settingsStoreMessages } from '../web/src/features/settings/messages.ts'
import { appearanceMessages } from '../web/src/features/settings/messages.ts'

const schemaEn = messagesOf(settingsSchemaMessages, 'en')
const schemaZh = messagesOf(settingsSchemaMessages, 'zh')
const storeEn = messagesOf(settingsStoreMessages, 'en')
const fieldEn = messagesOf(settingsFieldMessages, 'en')
const fieldZh = messagesOf(settingsFieldMessages, 'zh')

function namespace(ns: string, value: SettingObject, schema: unknown): SettingsNamespace {
  return { ns, autoGenerate: true, revision: 1, schema, value, applies: 'live' }
}

function typeSchema(value: SettingObject): unknown {
  const dict: Record<string, number> = {}
  const refs: Record<number, unknown> = { 0: { type: 'object', dict } }
  for (const [index, [key, current]] of Object.entries(value).entries()) {
    dict[key] = index + 1
    refs[index + 1] = { type: typeof current }
  }
  return { uid: 0, refs }
}

function numberField(): SettingField {
  return {
    path: ['count'], kind: 'number', label: 'Count', description: '', overridden: false, disabled: false,
    required: false, min: 1, max: 5, step: 2,
  }
}

test('Host の題名と説明は、その画面の言語で書かれているときだけ表示する', () => {
  const row = namespace('agent-loop', {}, { uid: 1, refs: {
    1: { type: 'object', dict: { enabled: 2, count: 3, notify: 4 } },
    2: { type: 'boolean', meta: { title: 'Enable the feature', description: 'Turns it on.' } },
    3: { type: 'number', meta: { title: '実行する', description: '自動で実行します。' } },
    4: { type: 'boolean', meta: { title: '启用通知', description: '打开后发送通知。' } },
  } })
  const en = schemaFields(row, undefined, schemaEn, 'en')
  assert.equal(en[0]!.label, 'Enable the feature')
  assert.equal(en[0]!.description, 'Turns it on.')
  assert.equal(en[1]!.label, 'Count', 'a Japanese title falls back to the English name')
  assert.equal(en[1]!.description, 'The description is available on the standard screen.')
  assert.equal(en[2]!.label, 'Item 3', 'a Chinese title is not shown in English')
  assert.equal(en[2]!.description, 'The description is available on the standard screen.')

  const zh = schemaFields(row, undefined, schemaZh, 'zh')
  assert.equal(zh[0]!.label, '启用', 'an English title falls back to the Chinese name')
  assert.equal(zh[0]!.description, '可在标准界面查看说明。')
  assert.equal(zh[2]!.label, '启用通知')
  assert.equal(zh[2]!.description, '打开后发送通知。')

  const ja = schemaFields(row)
  assert.equal(ja[0]!.label, '有効にする', 'Japanese stays as before')
  assert.equal(ja[0]!.description, '説明は標準の画面で確認できます。')
  assert.equal(ja[1]!.label, '実行する')
  assert.equal(ja[1]!.description, '自動で実行します。')
})

test('数値の入力の誤りは、選んだ言語の辞書で返す', () => {
  const field = numberField()
  assert.deepEqual(parseFieldInput(field, '0', schemaEn, 'en'), { ok: false, message: 'Enter 1 or more.' })
  assert.deepEqual(parseFieldInput(field, '6', schemaEn, 'en'), { ok: false, message: 'Enter 5 or less.' })
  assert.deepEqual(parseFieldInput(field, '1.5', schemaEn, 'en'), { ok: false, message: 'Enter a multiple of 2.' })
  assert.deepEqual(parseFieldInput(field, '0', schemaZh, 'zh'), { ok: false, message: '请输入 1 或更大的值。' })
  assert.deepEqual(parseFieldInput(field, '1.5', schemaZh, 'zh'), { ok: false, message: '请输入 2 的倍数。' })
  assert.deepEqual(parseFieldInput(field, '3', schemaEn, 'en'), { ok: true, value: 3 })
  // The Japanese output must stay identical.
  assert.deepEqual(parseFieldInput(field, '0'), { ok: false, message: '1 以上にしてください。' })
})

test('設定トップの要約を、選んだ言語の区切りと項目名で作る', () => {
  const model = namespace('agent-default-model',
    { enabled: true, name: 'ダミー名', provider: 'deepseek-official', model: 'deepseek-chat', reasoningEffort: 'high' },
    typeSchema({ enabled: true, name: 'ダミー名', provider: 'deepseek-official', model: 'deepseek-chat', reasoningEffort: 'high' }))
  assert.equal(pageSummary('models', [model], undefined, schemaEn, 'en'), 'deepseek-chat · Reasoning effort: high')
  assert.equal(pageSummary('models', [model], undefined, schemaZh, 'zh'), 'deepseek-chat、推理等级：high')
  assert.equal(pageSummary('models', [model]), 'deepseek-chat・推論の強さ：high')

  const agent = namespace('agent-loop', { maxParallelToolCalls: 10 }, typeSchema({ maxParallelToolCalls: 10 }))
  assert.equal(pageSummary('agent', [agent], undefined, schemaEn, 'en'), 'Concurrent tools: 10')
  assert.equal(pageSummary('agent', [agent], undefined, schemaZh, 'zh'), '工具并发数：10')

  const tools = namespace('web-search-deepseek', { model: 'deepseek-chat', maxUses: 5 }, typeSchema({ model: 'deepseek-chat', maxUses: 5 }))
  assert.equal(pageSummary('tools', [tools], undefined, schemaEn, 'en'), 'Search model: deepseek-chat · Max searches: 5')
  assert.equal(pageSummary('tools', [tools], undefined, schemaZh, 'zh'), '搜索模型：deepseek-chat、搜索次数上限：5')
})

test('提供元の登録状況の要約を、選んだ言語で数える', () => {
  const row = (id: string, status: 'registered' | 'missing' | 'unnecessary' | 'unknown' | 'unset') =>
    ({ id, name: id, ns: `llm-${id}`, path: [], needsReference: false, status, writable: true })
  const state = { phase: 'ready' as const, rows: [row('a', 'registered'), row('b', 'missing'), row('c', 'unnecessary')] }
  assert.equal(providerSummary(state, schemaEn, 'en'), '1 registered · 1 not registered · 1 without a key')
  assert.equal(providerSummary(state, schemaZh, 'zh'), '已注册 1、未注册 1、无需密钥 1')
  assert.equal(providerSummary(state), '登録済み 1・未登録 1・キー不要 1')
  assert.equal(providerSummary({ phase: 'loading', rows: [] }, schemaEn, 'en'), 'Loading registration status…')
  assert.equal(providerSummary({ phase: 'ready', rows: [] }, schemaZh, 'zh'), '没有提供方')
})

test('設定のページ名と組み込みモードの名前は、選んだ言語の辞書から出す', () => {
  assert.equal(settingsPageTitle('providers', schemaEn), 'Providers & API keys')
  assert.equal(settingsPageTitle('permission', schemaZh), '权限')
  assert.equal(settingsPageTitle('models'), 'モデル')
  assert.equal(presetDisplayText({ id: 'standard', isDefault: true }, messagesOf(agentPresetMessages, 'en')).name, 'Standard mode')
  assert.equal(presetDisplayText({ id: 'cordis', isDefault: false }, messagesOf(agentPresetMessages, 'zh')).name, '创造模式')
  assert.equal(presetDisplayText({ id: 'standard', isDefault: true }, messagesOf(agentPresetMessages, 'ja')).name, '標準モード')
  // A custom declaration owns its copy in every language.
  assert.equal(presetDisplayText({ id: 'standard', isDefault: false, name: 'My mode' }, messagesOf(agentPresetMessages, 'en')).name, 'My mode')
})

test('保存の拒否理由は、日本語と中国語では読める文だけを出し、英語では固定の文にする', () => {
  assert.equal(displayableRejection('管理者の設定で拒否されました'), '管理者の設定で拒否されました')
  assert.equal(displayableRejection('settings/rejected: deny', 'en'), storeEn.rejected)
  assert.equal(displayableRejection('Denied by policy', 'en'), storeEn.rejected, 'English cannot be told apart from internal details')
  assert.equal(displayableRejection('该值不被允许。', 'zh'), '该值不被允许。')
  assert.equal(displayableRejection('不允许，请联系管理员。', 'zh'), '不允许，请联系管理员。')
  assert.equal(displayableRejection('この値は許可されていません。', 'zh'), messagesOf(settingsStoreMessages, 'zh').rejected)
  assert.equal(displayableRejection('bad value 42', 'zh'), messagesOf(settingsStoreMessages, 'zh').rejected)
  assert.equal(displayableRejection('denied', 'ja'), messagesOf(settingsStoreMessages, 'ja').rejected)
})

test('設定の辞書は、表示に使う言語の訳がすべてそろっている', () => {
  for (const catalog of [
    agentPresetMessages, settingsSchemaMessages, settingsScreenMessages,
    settingsFieldMessages, settingsStoreMessages, appearanceMessages,
  ]) {
    assert.deepEqual(untranslatedLocales(catalog), [])
  }
  // The message functions take the same values in every language.
  assert.equal(fieldEn.resetAria('Name'), 'Reset Name to the default')
  assert.equal(fieldZh.resetAria('名前'), '将名前恢复为默认值')
  assert.equal(fieldEn.saveFailed('Name'), 'Could not save “Name”. Reopen the settings to check.')
  assert.equal(fieldZh.savedValue('high'), '已保存的值：high')
})
