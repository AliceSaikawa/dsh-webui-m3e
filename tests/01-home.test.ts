import assert from 'node:assert/strict'
import test from 'node:test'
import { folderName, formatUpdatedAt, modelIcon, selectWorkspace, shortenHomePath, visibleSessions } from '../web/src/features/home/data.ts'
import { createHomePreferencesStore, parseHomePreferences } from '../web/src/features/home/preferences-store.ts'
import type { SessionSummary, WorkspaceView } from '../web/src/dsh/services.ts'

function workspace(workspaceId: string, sessionIds: readonly string[] = []): WorkspaceView {
  return { workspaceId, title: workspaceId, path: `/home/test/${workspaceId}`, sessionIds, createdAt: '', updatedAt: '' }
}
function session(id: string, values: Partial<SessionSummary> = {}): SessionSummary {
  return { retainedBy: {}, id, displayTitle: id, running: false, blank: false, updatedAt: 0, ...values }
}

test('saved workspace survives replacement, and missing selections fall back to the first item', () => {
  const first = workspace('first')
  const second = workspace('second')
  assert.equal(selectWorkspace([first, second], 'second'), second)
  const replacement = { ...second, title: '新しい名前' }
  assert.equal(selectWorkspace([first, replacement], 'second'), replacement)
  assert.equal(selectWorkspace([first, second], 'deleted'), first)
  assert.equal(selectWorkspace([first, second]), first)
  assert.equal(selectWorkspace([]), undefined)
})

test('visible sessions follow workspace order and omit archives, missing IDs, and subagents by default', () => {
  const byId = {
    first: session('first'), second: session('second'), archived: session('archived'),
    child: session('child', { origin: 'subagent', parentId: 'first' }), other: session('other'),
  }
  const current = workspace('current', ['second', 'missing', 'child', 'archived', 'first', 'toString'])
  assert.deepEqual(visibleSessions(current, byId, ['archived'], false).map(item => item.id), ['second', 'first'])
  assert.deepEqual(visibleSessions(current, byId, ['archived'], true).map(item => item.id), ['second', 'child', 'first'])
  assert.deepEqual(visibleSessions(undefined, byId, [], true), [])
  assert.deepEqual(current.sessionIds, ['second', 'missing', 'child', 'archived', 'first', 'toString'])
})

test('updated dates use the local calendar day and two-digit times and dates', () => {
  const now = new Date(2026, 8, 25, 15, 30)
  assert.equal(formatUpdatedAt(new Date(2026, 8, 25, 9, 5).getTime(), now), '09:05')
  assert.equal(formatUpdatedAt(new Date(2026, 8, 24, 23, 59).getTime(), now), '2026/09/24')
  assert.equal(formatUpdatedAt(new Date(2025, 0, 2, 9, 5).getTime(), now), '2025/01/02')
  assert.equal(formatUpdatedAt(Number.NaN, now), '日時不明')
  assert.equal(formatUpdatedAt(Number.POSITIVE_INFINITY, now), '日時不明')
  assert.equal(formatUpdatedAt(1e20, now), '日時不明')
})

test('folder labels support a missing path, root, trailing separators, and Windows paths', () => {
  assert.equal(folderName('/home/test/project/'), 'project')
  assert.equal(folderName('C:\\work\\project\\'), 'project')
  assert.equal(folderName('/'), '/')
  assert.equal(folderName(), '作業フォルダなし')
})

test('home shortening respects path boundaries and requires a known home path', () => {
  assert.equal(shortenHomePath('/home/test', '/home/test'), '~')
  assert.equal(shortenHomePath('/home/test/', '/home/test/'), '~')
  assert.equal(shortenHomePath('/home/test/dev', '/home/test/'), '~/dev')
  assert.equal(shortenHomePath('/home/testing/dev', '/home/test'), '/home/testing/dev')
  assert.equal(shortenHomePath('/elsewhere/home/test', '/home/test'), '/elsewhere/home/test')
  assert.equal(shortenHomePath('/home/test/dev'), '/home/test/dev')
  assert.equal(shortenHomePath('/dev', '/'), '/dev')
  assert.equal(shortenHomePath('C:\\Users\\test\\dev', 'C:\\Users\\test'), '~\\dev')
})

test('model icons use DeepSeek identity, a Unicode initial, or a generic fallback', () => {
  assert.deepEqual(modelIcon({ provider: 'deepseek', model: 'chat' }), { kind: 'deepseek' })
  assert.deepEqual(modelIcon({ provider: 'other', model: 'deepseek-ai/DeepSeek-V3' }), { kind: 'deepseek' })
  assert.deepEqual(modelIcon({ provider: 'other', model: 'DeepSeek-V4' }), { kind: 'deepseek' })
  assert.deepEqual(modelIcon({ provider: 'other', model: ' gpt-test ' }), { kind: 'initial', initial: 'G' })
  assert.deepEqual(modelIcon({ model: '日本語モデル' }), { kind: 'initial', initial: '日' })
  assert.deepEqual(modelIcon({ model: '🚀モデル' }), { kind: 'initial', initial: '🚀' })
  assert.deepEqual(modelIcon({ provider: 'deepseek', model: ' ' }), { kind: 'generic' })
  assert.deepEqual(modelIcon({ model: 123 }), { kind: 'generic' })
  assert.deepEqual(modelIcon(null), { kind: 'generic' })
})

test('stored preferences accept only the supported values and tolerate damaged JSON', () => {
  assert.deepEqual(parseHomePreferences('{"workspaceId":"saved","showSubagents":true}'), { workspaceId: 'saved', showSubagents: true })
  for (const value of [null, 'broken', 'null', '[]', 'false', '{"workspaceId":12,"showSubagents":"true"}']) {
    assert.deepEqual(parseHomePreferences(value), { workspaceId: null, showSubagents: false })
  }
})

test('preferences persist both choices, reuse unchanged snapshots, and notify on changes only', () => {
  let saved: string | null = '{"workspaceId":"saved","showSubagents":true}'
  const storage = { getItem: () => saved, setItem: (_key: string, next: string) => { saved = next } }
  const store = createHomePreferencesStore(() => storage)
  let notifications = 0
  const unsubscribe = store.subscribe(() => { notifications++ })
  const initial = store.getSnapshot()
  assert.equal(store.getSnapshot(), initial)
  assert.deepEqual(initial, { workspaceId: 'saved', showSubagents: true })
  store.setCurrentWorkspace('next')
  store.setShowSubagents(false)
  store.setShowSubagents(false)
  assert.equal(notifications, 2)
  assert.deepEqual(JSON.parse(saved!), { workspaceId: 'next', showSubagents: false })
  saved = '{"workspaceId":"another-tab","showSubagents":true}'
  store.refresh()
  assert.deepEqual(store.getSnapshot(), { workspaceId: 'another-tab', showSubagents: true })
  unsubscribe()
  store.setCurrentWorkspace(null)
  assert.equal(notifications, 3)
})

test('blocked device storage does not prevent changing or retaining local preferences', () => {
  const store = createHomePreferencesStore(() => { throw new Error('保存できません') })
  assert.deepEqual(store.getSnapshot(), { workspaceId: null, showSubagents: false })
  store.setCurrentWorkspace('current')
  store.setShowSubagents(true)
  store.refresh()
  assert.deepEqual(store.getSnapshot(), { workspaceId: 'current', showSubagents: true })
  const saved = '{"workspaceId":"saved","showSubagents":false}'
  const writeBlocked = createHomePreferencesStore(() => ({ getItem: () => saved, setItem: () => { throw new Error('保存できません') } }))
  writeBlocked.setCurrentWorkspace('current')
  writeBlocked.refresh()
  assert.equal(writeBlocked.getSnapshot().workspaceId, 'current')
})
