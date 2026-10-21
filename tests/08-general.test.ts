import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { extendMock, type SettingsMockRemote } from '../web/src/features/settings/mock.ts'
import { settingsFixtures } from '../web/src/features/settings/mock-fixtures.ts'
import { effectiveValue, generalEntries, generalRows } from '../web/src/features/settings/general.ts'
import { generalMessages } from '../web/src/features/settings/messages.ts'
import { generalNamespaces, groupNamespaces, type SettingsNamespace } from '../web/src/features/settings/schema.ts'
import { createSettingsStore, fieldKey, type SettingsApi } from '../web/src/features/settings/store.ts'
import { codingToolsDisabled } from '../web/src/features/settings/agent-presets.ts'
import { messagesOf } from '../web/src/i18n/catalog.ts'

const ja = messagesOf(generalMessages, 'ja')
const row = (ns: string): SettingsNamespace => settingsFixtures().find(item => item.ns === ns)!

function harness(scenario?: string) {
  const ctx = createMockContext({ scenario, extensions: [{ extendMock }] })
  const remote = ctx.remote.settings as SettingsMockRemote
  const calls: { ns: string; patch: unknown; revision: number }[] = []
  const api: SettingsApi = {
    describe: () => remote.describe(),
    update: (ns, patch, revision) => { calls.push({ ns, patch: structuredClone(patch), revision }); return remote.update(ns, patch, revision) },
    mutate: (ns, ops, revision) => remote.mutate(ns, ops, revision),
  }
  const store = createSettingsStore(api)
  return { store, calls }
}
const stored = (store: ReturnType<typeof createSettingsStore>, ns: string) => store.getSnapshot().namespaces.find(item => item.ns === ns)!

test('コーディングビューの行は ui-settings の enabled をスイッチで出し、題名と説明は辞書から取る', () => {
  const [entry, ...rest] = generalEntries([row('ui-settings')], ja)
  assert.equal(rest.length, 0)
  assert.equal(entry!.id, 'codingView')
  assert.deepEqual({ kind: entry!.display.kind, label: entry!.display.label, path: entry!.field.path, ns: entry!.namespace.ns },
    { kind: 'switch', label: 'コーディングビューを表示', path: ['enabled'], ns: 'ui-settings' })
  assert.equal(entry!.display.description, 'オフにすると、PTC モードと最小モードを選べなくなります。標準の画面では、トレースやコードの差分の表示も切り替わります。')
})

test('英語と中国語の題名は標準の画面の辞書と同じ語（Show coding view、显示代码工作视图）', () => {
  assert.equal(generalEntries([row('ui-settings')], messagesOf(generalMessages, 'en'))[0]!.display.label, 'Show coding view')
  assert.equal(generalEntries([row('ui-settings')], messagesOf(generalMessages, 'zh'))[0]!.display.label, '显示代码工作视图')
  assert.equal(messagesOf(generalMessages, 'en').title, 'General')
  assert.equal(messagesOf(generalMessages, 'zh').title, '通用设置')
})

test('保存した値がなければ標準の画面と同じくオン（true）として表示する', () => {
  const [entry] = generalEntries([row('ui-settings')], ja)
  assert.equal(entry!.display.effective!(undefined), true)
  assert.equal(entry!.display.effective!(false), false)
  assert.equal(effectiveValue({ fallback: 'detailed', legacy: { normal: 'detailed' } }, 'normal'), 'detailed')
})

test('名前空間がない Host、期待と違う型の Host では行を出さない（推測で出さない）', () => {
  assert.deepEqual(generalEntries([], ja), [])
  const other = { ...row('ui-settings'), schema: { uid: 0, refs: { 0: { type: 'object', dict: { enabled: 1 } }, 1: { type: 'string' } } } }
  assert.deepEqual(generalEntries([other], ja), [])
})

test('専用の行がある名前空間は汎用のページに出ず、ほかの ui-* もこれまでどおり出ない', () => {
  const names = ['ui-settings', 'ui-chat', 'ui-theme', 'ui-future', 'web', 'locale']
  const groups = groupNamespaces(names.map(ns => ({ ...row('ui-settings'), ns, autoGenerate: true })))
  assert.deepEqual(Object.values(groups).flat().map(item => item.ns).filter(ns => ns.startsWith('ui-')), [])
  for (const ns of generalNamespaces) assert.ok(!Object.values(groups).flat().some(item => item.ns === ns))
  assert.deepEqual(generalRows.filter(item => !generalNamespaces.includes(item.ns)), [])
})

test('オフにすると ui-settings に { enabled: false } を書き、PTC と最小を隠す判定がその値に従う', async () => {
  const { store, calls } = harness()
  await store.reload()
  assert.equal(codingToolsDisabled(store.getSnapshot().namespaces), false)
  assert.equal(await store.edit('ui-settings', ['enabled'], false), true)
  assert.deepEqual(calls, [{ ns: 'ui-settings', patch: { enabled: false }, revision: 0 }])
  assert.deepEqual(stored(store, 'ui-settings').value, { enabled: false })
  assert.equal(codingToolsDisabled(store.getSnapshot().namespaces), true)
  assert.equal(await store.edit('ui-settings', ['enabled'], true), true)
  assert.equal(codingToolsDisabled(store.getSnapshot().namespaces), false)
  assert.equal(calls[1]!.revision, 1)
})

test('標準の画面が先に保存していたら、競合として読み直し、入力は残して再保存できる', async () => {
  const { store, calls } = harness('settings-conflict')
  const notices: string[] = []
  store.subscribeNotice(message => notices.push(message))
  await store.reload()
  const input = store.input('ui-settings', ['enabled'])
  input.change(false)
  await input.flush()
  assert.deepEqual(notices, ['ほかの場所で設定が変わりました。読み直しました'])
  assert.equal(input.getSnapshot().dirty, true)
  assert.match(input.getSnapshot().notice ?? '', /ほかの場所で設定が変わりました/)
  assert.deepEqual(stored(store, 'ui-settings').value, { enabled: true })
  await input.retry()
  assert.deepEqual(stored(store, 'ui-settings').value, { enabled: false })
  assert.equal(calls.length, 2)
  assert.equal(calls[1]!.revision, 1)
})

test('Host が拒否したら理由を項目の下に出し、保存済みの値は変わらない', async () => {
  const { store } = harness('settings-rejected')
  await store.reload()
  assert.equal(await store.edit('ui-settings', ['enabled'], false), false)
  assert.equal(store.getSnapshot().fieldErrors[fieldKey('ui-settings', ['enabled'])], 'この値は管理者の設定によって許可されていません。')
  assert.deepEqual(stored(store, 'ui-settings').value, { enabled: true })
})

test('書き込めない DSH では何も送らない', async () => {
  const { store, calls } = harness('settings-readonly')
  await store.reload()
  assert.equal(store.getSnapshot().writable, false)
  assert.equal(await store.edit('ui-settings', ['enabled'], false), false)
  assert.deepEqual(calls, [])
})
