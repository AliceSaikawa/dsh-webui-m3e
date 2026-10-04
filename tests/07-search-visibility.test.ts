import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SessionListState, SessionSummary } from '../web/src/dsh/services.ts'
import {
  createHomePreferencesStore,
  homePreferencesStorageKey,
  type PreferenceStorage,
} from '../web/src/features/home/preferences-store.ts'
import {
  filterVisibleSearchItems,
  selectVisibleRecentSessions,
} from '../web/src/features/search/search-visibility.ts'

type SearchSessionList = Pick<SessionListState, 'ids' | 'byId' | 'phase'>

function session(id: string, updatedAt: number, patch: Partial<SessionSummary> = {}): SessionSummary {
  return { retainedBy: {}, id, displayTitle: id, running: false, blank: false, updatedAt, ...patch }
}

function sessionList(rows: readonly SessionSummary[], patch: Partial<SearchSessionList> & { current?: string } = {}): SearchSessionList {
  const { current, ...state } = patch
  return {
    ids: rows.map(row => row.id),
    byId: Object.fromEntries(rows.map(row => [row.id, current === row.id ? { ...row, retainedBy: { 'm3e.mainView': 1 } } : row])),
    phase: 'ready',
    ...state,
  }
}

function item(sessionId: string) {
  return { sessionId, snippet: `${sessionId} の一致箇所` }
}

const noArchivedSessions = { archivedSessionIds: [] }

test('search omits subagents, archived rows and every blank row including the current one', () => {
  const list = sessionList([
    session('通常', 1),
    session('子', 2, { origin: 'subagent', parentId: '通常' }),
    session('保管済み', 3),
    session('未選択の空', 4, { blank: true }),
    session('選択中の空', 5, { blank: true }),
  ], { current: '選択中の空' })
  const items = list.ids.map(item)
  assert.deepEqual(filterVisibleSearchItems(items, list, { archivedSessionIds: ['保管済み'] }), [items[0]])
})

test('ready search results require both list membership and current metadata', () => {
  const list = sessionList([session('存在', 1), session('辞書にだけ残存', 2)])
  list.ids = ['存在', 'メタデータ欠落']
  const items = ['存在', '辞書にだけ残存', 'メタデータ欠落', '不明'].map(item)
  assert.deepEqual(filterVisibleSearchItems(items, list, noArchivedSessions), [items[0]])
})

test('deleting a session removes it from previously completed search results without a new response', () => {
  const present = session('残す', 1)
  const removed = session('削除する', 2)
  const rawResults = Object.freeze([item(present.id), item(removed.id)])
  assert.deepEqual(filterVisibleSearchItems(rawResults, sessionList([present, removed]), noArchivedSessions), rawResults)
  const updatedList = sessionList([present])
  assert.deepEqual(filterVisibleSearchItems(rawResults, updatedList, noArchivedSessions), [rawResults[0]])
  assert.equal(rawResults.length, 2)
})

test('pending metadata is withheld and raw results can reappear when the authoritative list arrives', () => {
  const rawResults = Object.freeze([item('読み込み待ち')])
  const pending = sessionList([], { phase: 'pending' })
  assert.deepEqual(filterVisibleSearchItems(rawResults, pending, noArchivedSessions), [])
  assert.deepEqual(filterVisibleSearchItems(rawResults, sessionList([]), noArchivedSessions), [])
  const ready = sessionList([session('読み込み待ち', 1)])
  assert.deepEqual(filterVisibleSearchItems(rawResults, ready, noArchivedSessions), rawResults)
  assert.equal(rawResults[0]!.sessionId, '読み込み待ち')
})

test('archive changes immediately hide cached results while preserving the search response order', () => {
  const list = sessionList([session('先', 1), session('後', 2)])
  const rawResults = [item('先'), item('後')]
  const visible = filterVisibleSearchItems(rawResults, list, noArchivedSessions)
  assert.deepEqual(visible, rawResults)
  assert.equal(visible[0], rawResults[0])
  assert.deepEqual(filterVisibleSearchItems(rawResults, list, { archivedSessionIds: ['先'] }), [rawResults[1]])
  assert.deepEqual(filterVisibleSearchItems(rawResults, list, noArchivedSessions), rawResults)
})

test('recent rows include only the selected blank and exclude subagents and archived sessions', () => {
  const ordinary = session('通常', 1)
  const selectedBlank = session('選択中の空', 5, { blank: true, retainedBy: { 'm3e.mainView': 1 } })
  const list = sessionList([
    ordinary,
    session('子', 6, { origin: 'subagent' }),
    session('保管済み', 7),
    session('未選択の空', 8, { blank: true }),
    selectedBlank,
  ], { current: selectedBlank.id })
  assert.deepEqual(selectVisibleRecentSessions(list, { archivedSessionIds: ['保管済み'] }), [selectedBlank, ordinary])
  assert.deepEqual(selectVisibleRecentSessions({ ...list, byId: { ...list.byId, [selectedBlank.id]: { ...selectedBlank, retainedBy: {} } } }, { archivedSessionIds: ['保管済み'] }), [ordinary])
})

test('recent rows require existing metadata even while the list is pending', () => {
  const ordinary = session('存在', 1)
  const list = sessionList([ordinary, session('辞書にだけ残存', 2)], {
    ids: ['存在', 'メタデータ欠落'], phase: 'pending',
  })
  assert.deepEqual(selectVisibleRecentSessions(list, noArchivedSessions), [ordinary])
  assert.deepEqual(selectVisibleRecentSessions({ ...list, phase: 'ready' }, noArchivedSessions), [ordinary])
})

test('recent rows are filtered before taking the five newest and input snapshots remain unchanged', () => {
  const rows = [
    session('一番目', 60), session('二番目', 50), session('三番目', 40),
    session('四番目', 30), session('五番目', 20), session('六番目', 10),
    session('除外する子', 90, { origin: 'subagent' }),
    session('除外する保管済み', 80), session('除外する空', 70, { blank: true }),
  ]
  const list = sessionList([...rows].reverse())
  const originalIds = [...list.ids]
  const originalRows = { ...list.byId }
  const workspaces = { archivedSessionIds: ['除外する保管済み'] }
  Object.freeze(list.ids)
  Object.freeze(list.byId)
  Object.freeze(workspaces.archivedSessionIds)
  const recent = selectVisibleRecentSessions(list, workspaces)
  assert.deepEqual(recent.map(row => row.id), ['一番目', '二番目', '三番目', '四番目', '五番目'])
  assert.deepEqual(list.ids, originalIds)
  assert.deepEqual(list.byId, originalRows)
  assert.equal(recent[0], rows[0])
  assert.deepEqual(selectVisibleRecentSessions(list, workspaces, 1), [rows[0]])
  assert.deepEqual(selectVisibleRecentSessions(list, workspaces, 0), [])
})

test('changing the subagent flag reevaluates cached search items without changing their order or content', () => {
  const list = sessionList([
    session('親', 1),
    session('子', 2, { origin: 'subagent', parentId: '親' }),
  ])
  const rawResults = Object.freeze([item('子'), item('親')])
  assert.deepEqual(filterVisibleSearchItems(rawResults, list, noArchivedSessions), [rawResults[1]])
  assert.deepEqual(filterVisibleSearchItems(rawResults, list, noArchivedSessions, false), [rawResults[1]])
  const enabled = filterVisibleSearchItems(rawResults, list, noArchivedSessions, true)
  assert.deepEqual(enabled, rawResults)
  assert.equal(enabled[0], rawResults[0])
  assert.deepEqual(filterVisibleSearchItems(rawResults, list, noArchivedSessions, false), [rawResults[1]])
  assert.deepEqual(rawResults.map(row => row.sessionId), ['子', '親'])
})

test('showing subagents never restores archived, missing or query-excluded blank rows', () => {
  const parent = session('親', 1)
  const child = session('子', 2, { origin: 'subagent', parentId: parent.id })
  const selectedBlank = session('選択中の空の子', 3, { retainedBy: { 'm3e.mainView': 1 }, origin: 'subagent', blank: true })
  const list = sessionList([
    parent, child, selectedBlank,
    session('未選択の空の子', 4, { origin: 'subagent', blank: true }),
    session('保管済みの子', 5, { origin: 'subagent' }),
    session('辞書にだけ残る子', 6, { origin: 'subagent' }),
  ], { current: selectedBlank.id })
  list.ids = list.ids.filter(id => id !== '辞書にだけ残る子').concat('メタデータ欠落')
  const rawResults = [...Object.keys(list.byId), 'メタデータ欠落', '不明'].map(item)
  const workspaces = { archivedSessionIds: ['保管済みの子'] }
  for (const showSubagents of [false, true]) {
    assert.deepEqual(
      filterVisibleSearchItems(rawResults, list, workspaces, showSubagents).map(row => row.sessionId),
      showSubagents ? [parent.id, child.id] : [parent.id],
    )
    assert.deepEqual(
      selectVisibleRecentSessions(list, workspaces, 5, showSubagents),
      showSubagents ? [selectedBlank, child, parent] : [parent],
    )
  }
})

test('recent limits apply after subagent and archive filtering with the flag both off and on', () => {
  const ordinary = Array.from({ length: 6 }, (_, index) => session(`通常${index + 1}`, index + 1))
  const child = session('子', 100, { origin: 'subagent' })
  const archivedChild = session('保管済みの子', 200, { origin: 'subagent' })
  const list = sessionList([archivedChild, child, ...ordinary])
  const workspaces = { archivedSessionIds: [archivedChild.id] }
  assert.deepEqual(selectVisibleRecentSessions(list, workspaces).map(row => row.id), ['通常6', '通常5', '通常4', '通常3', '通常2'])
  assert.deepEqual(selectVisibleRecentSessions(list, workspaces, 5, true).map(row => row.id), ['子', '通常6', '通常5', '通常4', '通常3'])
  assert.deepEqual(selectVisibleRecentSessions(list, workspaces, 2, false).map(row => row.id), ['通常6', '通常5'])
  assert.deepEqual(selectVisibleRecentSessions(list, workspaces, 2, true).map(row => row.id), ['子', '通常6'])
})

test('the existing home preferences store updates both cached search results and recent rows', () => {
  const stored = new Map([[homePreferencesStorageKey, JSON.stringify({ workspaceId: null, showSubagents: true })]])
  const preferences = createHomePreferencesStore(() => ({
    getItem: key => stored.get(key) ?? null,
    setItem: (key, value) => { stored.set(key, value) },
  }))
  const list = sessionList([session('親', 1), session('子', 2, { origin: 'subagent' })])
  const rawResults = Object.freeze([item('親'), item('子')])
  const readVisible = () => {
    const { showSubagents } = preferences.getSnapshot()
    return {
      search: filterVisibleSearchItems(rawResults, list, noArchivedSessions, showSubagents).map(row => row.sessionId),
      recent: selectVisibleRecentSessions(list, noArchivedSessions, 5, showSubagents).map(row => row.id),
    }
  }
  let visible = readVisible()
  const unsubscribe = preferences.subscribe(() => { visible = readVisible() })
  assert.deepEqual(visible, { search: ['親', '子'], recent: ['子', '親'] })
  preferences.setShowSubagents(false)
  assert.deepEqual(visible, { search: ['親'], recent: ['親'] })
  preferences.setShowSubagents(true)
  assert.deepEqual(visible, { search: ['親', '子'], recent: ['子', '親'] })
  assert.equal(JSON.parse(stored.get(homePreferencesStorageKey)!).showSubagents, true)
  assert.equal(rawResults.length, 2)
  unsubscribe()
})

const unavailableStorage: { name: string; storage: () => PreferenceStorage | undefined }[] = [
  { name: 'storage is unavailable', storage: () => undefined },
  { name: 'reading and writing throw', storage: () => ({
    getItem() { throw new Error('読み込みできません') },
    setItem() { throw new Error('保存できません') },
  }) },
  { name: 'writing throws', storage: () => ({
    getItem: () => null,
    setItem() { throw new Error('保存できません') },
  }) },
]

for (const { name, storage } of unavailableStorage) {
  test(`home preferences still update search in memory when ${name}`, () => {
    const preferences = createHomePreferencesStore(storage)
    const list = sessionList([session('親', 1), session('子', 2, { origin: 'subagent' })])
    const rawResults = Object.freeze([item('親'), item('子')])
    const readVisible = () => {
      const { showSubagents } = preferences.getSnapshot()
      return {
        search: filterVisibleSearchItems(rawResults, list, noArchivedSessions, showSubagents).map(row => row.sessionId),
        recent: selectVisibleRecentSessions(list, noArchivedSessions, 5, showSubagents).map(row => row.id),
      }
    }
    let visible = readVisible()
    const unsubscribe = preferences.subscribe(() => { visible = readVisible() })
    assert.deepEqual(visible, { search: ['親'], recent: ['親'] })
    preferences.setShowSubagents(true)
    preferences.refresh()
    assert.equal(preferences.getSnapshot().showSubagents, true)
    assert.deepEqual(visible, { search: ['親', '子'], recent: ['子', '親'] })
    preferences.setShowSubagents(false)
    preferences.refresh()
    assert.deepEqual(visible, { search: ['親'], recent: ['親'] })
    unsubscribe()
  })
}
