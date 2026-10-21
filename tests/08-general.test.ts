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

const chat = () => settingsFixtures().find(item => item.ns === 'ui-chat')!
const entry = (id: string, locale: 'ja' | 'en' | 'zh' = 'ja', rows: SettingsNamespace[] = [chat()]) =>
  generalEntries(rows, messagesOf(generalMessages, locale)).find(item => item.id === id)!

test('作業の詳細・折りたたむタイミング・パフォーマンスと使用状況は ui-chat の選択として、標準の画面と同じ選択肢を同じ順で出す', () => {
  const labels = (id: string, locale: 'ja' | 'en' | 'zh') => entry(id, locale).display.choices!.map(choice => `${choice.value}=${choice.label}`)
  assert.deepEqual(generalEntries([chat()], ja).map(item => item.id), ['transcriptView', 'collapseTiming', 'performanceUsage'])
  assert.deepEqual(labels('transcriptView', 'ja'), ['compact=簡潔', 'standard=標準', 'detailed=詳細', 'verbose=完全に展開'])
  assert.deepEqual(labels('transcriptView', 'en'), ['compact=Compact', 'standard=Standard', 'detailed=Detailed', 'verbose=Verbose'])
  assert.deepEqual(labels('transcriptView', 'zh'), ['compact=简洁', 'standard=标准', 'detailed=详细', 'verbose=完全展开'])
  assert.deepEqual(labels('collapseTiming', 'ja'), ['completion=回答の完了時', 'next-input=次のメッセージの送信時'])
  assert.deepEqual(labels('collapseTiming', 'en'), ['completion=On completion', 'next-input=On next message'])
  assert.deepEqual(labels('collapseTiming', 'zh'), ['completion=回答结束后', 'next-input=下次有新消息时'])
  assert.deepEqual(labels('performanceUsage', 'ja'), ['compact=簡潔', 'detailed=詳細'])
  assert.deepEqual(labels('performanceUsage', 'en'), ['compact=Compact', 'detailed=Detailed'])
  assert.deepEqual(labels('performanceUsage', 'zh'), ['compact=简洁', 'detailed=详细'])
  assert.deepEqual(['transcriptView', 'collapseTiming', 'performanceUsage'].map(id => entry(id, 'ja').display.label),
    ['作業の詳細', '作業の詳細を折りたたむタイミング', 'パフォーマンスと使用状況'])
  assert.deepEqual(['transcriptView', 'collapseTiming', 'performanceUsage'].map(id => entry(id, 'en').display.label),
    ['Work details', 'When to Collapse Work Details', 'Performance & usage'])
  assert.deepEqual(['transcriptView', 'collapseTiming', 'performanceUsage'].map(id => entry(id, 'zh').display.label),
    ['工作步骤展示', '工作步骤收起时机', '性能与用量'])
})

test('保存した値がないときは標準の画面と同じ既定を選んだ形で出し、古い normal・expanded は「詳細」に読み替える', () => {
  const shown = (id: string, stored: unknown) => entry(id).display.effective!(stored as never)
  assert.equal(shown('transcriptView', undefined), 'detailed')
  assert.equal(shown('transcriptView', 'normal'), 'detailed')
  assert.equal(shown('transcriptView', 'expanded'), 'detailed')
  assert.equal(shown('transcriptView', 'verbose'), 'verbose')
  assert.equal(shown('collapseTiming', undefined), 'completion')
  assert.equal(shown('performanceUsage', undefined), 'detailed')
  assert.equal(shown('performanceUsage', 'compact'), 'compact')
})

test('Host のスキーマが選択肢を持たなければ、その行だけを出さない', () => {
  const narrowed: SettingsNamespace = { ...chat(), schema: { uid: 0, refs: {
    0: { type: 'object', dict: { transcriptView: 1, collapseTiming: 4, performanceUsage: 7 } },
    1: { type: 'union', list: [2, 3] }, 2: { type: 'const', value: 'compact' }, 3: { type: 'const', value: 'standard' },
    4: { type: 'union', list: [5, 6] }, 5: { type: 'const', value: 'completion' }, 6: { type: 'const', value: 'next-input' },
    7: { type: 'union', list: [8, 9] }, 8: { type: 'const', value: 'compact' }, 9: { type: 'const', value: 'detailed' },
  } } }
  assert.deepEqual(generalEntries([narrowed], ja).map(item => item.id), ['collapseTiming', 'performanceUsage'])
})

test('選んだ値は、その項目だけを ui-chat に書き、ほかの項目と revision を保つ', async () => {
  const { store, calls } = harness()
  await store.reload()
  assert.equal(await store.edit('ui-chat', ['transcriptView'], 'verbose'), true)
  assert.equal(await store.edit('ui-chat', ['collapseTiming'], 'next-input'), true)
  assert.equal(await store.edit('ui-chat', ['performanceUsage'], 'compact'), true)
  assert.deepEqual(calls.map(call => [call.patch, call.revision]), [
    [{ transcriptView: 'verbose' }, 0], [{ collapseTiming: 'next-input' }, 1], [{ performanceUsage: 'compact' }, 2]])
  assert.deepEqual(stored(store, 'ui-chat').value, { collapseTiming: 'next-input', performanceUsage: 'compact', linkOpening: 'sidebar', transcriptView: 'verbose' })
})

test('選択肢にない値は送らない', async () => {
  const { store, calls } = harness()
  await store.reload()
  assert.equal(await store.edit('ui-chat', ['performanceUsage'], 'verbose'), false)
  assert.deepEqual(calls, [])
})

test('ui-chat でも、競合は読み直して入力を残し、拒否は項目の下に理由を出す', async () => {
  const conflict = harness('settings-conflict')
  const notices: string[] = []
  conflict.store.subscribeNotice(message => notices.push(message))
  await conflict.store.reload()
  const input = conflict.store.input('ui-chat', ['collapseTiming'])
  input.change('next-input')
  await input.flush()
  assert.deepEqual(notices, ['ほかの場所で設定が変わりました。読み直しました'])
  assert.equal(input.getSnapshot().value, 'next-input')
  await input.retry()
  assert.equal((stored(conflict.store, 'ui-chat').value as { collapseTiming: string }).collapseTiming, 'next-input')
  const rejected = harness('settings-rejected')
  await rejected.store.reload()
  assert.equal(await rejected.store.edit('ui-chat', ['transcriptView'], 'compact'), false)
  assert.equal(rejected.store.getSnapshot().fieldErrors[fieldKey('ui-chat', ['transcriptView'])], 'この値は管理者の設定によって許可されていません。')
  const readonly = harness('settings-readonly')
  await readonly.store.reload()
  assert.equal(await readonly.store.edit('ui-chat', ['transcriptView'], 'compact'), false)
  assert.deepEqual(readonly.calls, [])
})
