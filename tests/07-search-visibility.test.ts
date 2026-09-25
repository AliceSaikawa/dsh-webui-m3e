import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SessionListState, SessionSummary } from '../web/src/dsh/services.ts'
import {
  filterVisibleSearchItems,
  selectVisibleRecentSessions,
} from '../web/src/features/search/search-visibility.ts'

type SearchSessionList = Pick<SessionListState, 'ids' | 'byId' | 'current' | 'phase'>

function session(id: string, updatedAt: number, patch: Partial<SessionSummary> = {}): SessionSummary {
  return { id, displayTitle: id, running: false, blank: false, updatedAt, ...patch }
}

function sessionList(rows: readonly SessionSummary[], patch: Partial<SearchSessionList> = {}): SearchSessionList {
  return {
    ids: rows.map(row => row.id),
    byId: Object.fromEntries(rows.map(row => [row.id, row])),
    current: undefined,
    phase: 'ready',
    ...patch,
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
  const selectedBlank = session('選択中の空', 5, { blank: true })
  const list = sessionList([
    ordinary,
    session('子', 6, { origin: 'subagent' }),
    session('保管済み', 7),
    session('未選択の空', 8, { blank: true }),
    selectedBlank,
  ], { current: selectedBlank.id })
  assert.deepEqual(selectVisibleRecentSessions(list, { archivedSessionIds: ['保管済み'] }), [selectedBlank, ordinary])
  assert.deepEqual(selectVisibleRecentSessions({ ...list, current: undefined }, { archivedSessionIds: ['保管済み'] }), [ordinary])
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
