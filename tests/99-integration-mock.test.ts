import { completionStatus } from '../web/src/dsh/completion-status.ts'
import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import test from 'node:test'
import { createMockContext, type MockExtension, type MockKit } from '../web/src/dsh/mock/context.ts'
import { MOCK_IDS } from '../web/src/dsh/mock/fixtures.ts'
import { unwrapRemoteResult } from '../web/src/dsh/remote-result.ts'
import { composerApi } from '../web/src/features/composer/api.ts'
import { mockPermissions } from '../web/src/features/composer/mock.ts'
import type { SettingsMockRemote } from '../web/src/features/settings/mock.ts'
import { INBOX_MOCK_IDS } from '../web/src/features/inbox/mock.ts'
import { HOME_MOCK_IDS } from '../web/src/features/home/mock.ts'
import { SESSION_TOOLS_MOCK_IDS } from '../web/src/features/session-tools/mock.ts'
import { filterVisibleSearchItems } from '../web/src/features/search/search-visibility.ts'

// Ported from integ/dry-run:tests/99-integration-mock.test.ts.
// Match the Vite collector's actual feature paths and sorted registration order.
const featureRoot = new URL('../web/src/features/', import.meta.url)
const sources = readdirSync(featureRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => `${entry.name}/mock.ts`)
  .filter(source => existsSync(new URL(source, featureRoot)))
  .sort()
const features: MockExtension[] = await Promise.all(sources.map(async source => {
  const extension = await import(new URL(source, featureRoot).href) as MockExtension
  assert.equal(typeof extension.extendMock, 'function', source)
  return { ...extension, source }
}))

function build(scenario?: string, extra: readonly MockExtension[] = []) {
  const messages: string[] = []
  const warn = console.warn
  const error = console.error
  console.warn = (...args: unknown[]) => { messages.push(`warn: ${args.map(String).join(' ')}`) }
  console.error = (...args: unknown[]) => { messages.push(`error: ${args.map(String).join(' ')}`) }
  try {
    return { ctx: createMockContext({ scenario, extensions: [...extra, ...features] }), messages }
  } finally {
    console.warn = warn
    console.error = error
  }
}

function scenarioNames(): string[] {
  // The foundation registers these before extensions receive MockKit.
  const names = ['disconnected', 'reconnecting', 'approval-demo']
  const recorder: MockExtension = { source: '99-integration-recorder', extendMock(kit: MockKit) {
    const register = kit.scenario.bind(kit)
    kit.scenario = (name, setup) => { names.push(name); register(name, setup) }
  } }
  const { ctx, messages } = build(undefined, [recorder])
  ctx.dispose()
  assert.deepEqual(messages, [])
  assert.equal(new Set(names).size, names.length)
  return names
}

test('全機能の偽データを一緒に読み込んでも、名前空間・ID・状態名の重複の警告が出ない', () => {
  assert.equal(features.length, 10)
  const { ctx, messages } = build()
  ctx.dispose()
  assert.deepEqual(messages, [])
})

test('設定の偽の窓口は 08 の describe・update・mutate を持つ', async () => {
  const { ctx } = build()
  try {
    const remote = ctx.remote.settings as SettingsMockRemote
    assert.equal(typeof remote.describe, 'function')
    assert.equal(typeof remote.update, 'function')
    assert.equal(typeof remote.mutate, 'function')
    const description = unwrapRemoteResult(await remote.describe())
    assert.equal(description.writable, true)
    assert.ok(description.namespaces.some(namespace => namespace.ns === 'permission'))
  } finally { ctx.dispose() }
})

test('03 の新しい会話の権限候補は、08 の設定の偽データから読める', async () => {
  const { ctx } = build()
  try {
    const defaults = await composerApi(ctx.remote).defaultPermissions()
    assert.equal(defaults?.currentValue, mockPermissions.currentValue)
    assert.deepEqual(defaults?.options.map(option => option.value), mockPermissions.options.map(option => option.value))
  } finally { ctx.dispose() }
})

test('一覧の最初のワークスペースは共通の dsh-webui-m3e のまま', () => {
  const { ctx } = build()
  try {
    assert.equal(ctx.workspaces.list.getSnapshot().items[0]?.workspaceId, MOCK_IDS.workspaces.m3e)
  } finally { ctx.dispose() }
})

test('どの scenario も、全機能と一緒に登録して初期化時の例外も警告も出ない', async t => {
  for (const name of scenarioNames()) {
    await t.test(`scenario=${name}`, () => {
      const { ctx, messages } = build(name)
      try { assert.deepEqual(messages, []) }
      finally { ctx.dispose() }
    })
  }
})

test('サブエージェントの子は、親のカタログに mode 付きで載っている', () => {
  const { ctx } = build()
  try {
    const list = ctx.sessions.list.getSnapshot()
    const children = [
      { id: HOME_MOCK_IDS.child, mode: 'one-shot' },
      { id: SESSION_TOOLS_MOCK_IDS.children.review, mode: 'continuable' },
      { id: SESSION_TOOLS_MOCK_IDS.children.tests, mode: 'one-shot' },
    ] as const
    assert.deepEqual(Object.values(list.byId).filter(row => row.origin === 'subagent').map(row => row.id).sort(),
      children.map(child => child.id).sort())
    for (const child of children) {
      assert.ok(list.ids.includes(child.id), `${child.id}: 一覧に存在する`)
      const summary = list.byId[child.id]
      assert.ok(summary, `${child.id}: 子の情報が存在する`)
      assert.equal(summary.origin, 'subagent', `${child.id}: 子のorigin`)
      const parentId = summary.parentId
      assert.ok(typeof parentId === 'string' && parentId.trim().length > 0, `${child.id}: 親IDが空でない`)
      const entries = list.projectionsBySession[parentId]?.values.subagentCatalog
      assert.ok(Array.isArray(entries), `${child.id}: 親のカタログが存在する`)
      const entry = entries.find((entry: { id?: string }) => entry.id === child.id)
      assert.ok(entry, `${child.id}: 親のカタログに子が存在する`)
      assert.equal(entry.mode, child.mode, `${child.id}: カタログのmode`)
    }
  } finally { ctx.dispose() }
})

test('07 の検索用 4 会話はワークスペースに未所属という既知差異を記録する', () => {
  const { ctx } = build()
  try {
    const list = ctx.sessions.list.getSnapshot()
    const owned = new Set(ctx.workspaces.list.getSnapshot().items.flatMap(item => item.sessionIds))
    const orphans = list.ids.filter(id => list.byId[id]?.origin !== 'subagent' && !owned.has(id))
    // This assertion must change when 07 fixes workspace membership.
    assert.deepEqual(orphans, ['search-permissions', 'search-mobile', 'search-history', 'search-colors'])
  } finally { ctx.dispose() }
})

test('検索用セッションはワークスペース未所属でも検索結果から除外されない', async () => {
  const { ctx } = build()
  try {
    const result = unwrapRemoteResult(await ctx.sessions.search('承認', new AbortController().signal))
    const visible = filterVisibleSearchItems(result.items, ctx.sessions.list.getSnapshot(), ctx.workspaces.list.getSnapshot())
    for (const id of ['search-permissions', 'search-mobile']) {
      assert.ok(result.items.some(item => item.sessionId === id), `${id}: 検索サービスの結果`)
      assert.ok(visible.some(item => item.sessionId === id), `${id}: 検索画面へ渡す結果`)
    }
  } finally { ctx.dispose() }
})

test('scenario=inbox の完了は全機能の 3 件を含み、うち 2 件が inbox の偽データ', () => {
  const { ctx } = build('inbox')
  try {
    const list = ctx.sessions.list.getSnapshot()
    const completed = list.ids.filter(id => completionStatus(ctx).getSnapshot().byId[id]?.completionUnread === true)
    assert.deepEqual(new Set(completed), new Set([
      SESSION_TOOLS_MOCK_IDS.children.tests,
      INBOX_MOCK_IDS.completed, INBOX_MOCK_IDS.otherCompleted,
    ]))
    assert.equal(completed.length, 3)
    assert.deepEqual(completed.filter(id => id.startsWith('inbox-')), [INBOX_MOCK_IDS.completed, INBOX_MOCK_IDS.otherCompleted])
  } finally { ctx.dispose() }
})
