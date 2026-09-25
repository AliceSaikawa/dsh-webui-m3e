import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  findMatchRanges,
  normalizeQuery,
  selectRecentSessions,
  shouldSearch,
} from '../web/src/features/search/search-utils.ts'

test('search queries are trimmed and blank or unchanged queries are skipped', () => {
  assert.equal(normalizeQuery('  承認\n'), '承認')
  assert.equal(normalizeQuery('承認 シート'), '承認 シート')
  assert.equal(shouldSearch(' \t\n　'), false)
  assert.equal(shouldSearch(' 承認 ', '承認'), false)
  assert.equal(shouldSearch('承認', '\n承認 '), false)
  assert.equal(shouldSearch('承認'), true)
  assert.equal(shouldSearch('承認 シート', '承認'), true)
})

test('Japanese matches produce every non-overlapping range in the original excerpt', () => {
  const excerpt = '承認の前に承認内容を確認'
  assert.deepEqual(findMatchRanges(excerpt, '承認'), [
    { start: 0, end: 2 },
    { start: 5, end: 7 },
  ])
  assert.deepEqual(findMatchRanges('aaaa', 'aa'), [
    { start: 0, end: 2 },
    { start: 2, end: 4 },
  ])
})

test('matching ignores case, leaves unmatched text alone and skips blank queries', () => {
  assert.deepEqual(findMatchRanges('README と readme と ReadMe', 'readme'), [
    { start: 0, end: 6 },
    { start: 9, end: 15 },
    { start: 18, end: 24 },
  ])
  assert.deepEqual(findMatchRanges('承認の記録', '未確認'), [])
  assert.deepEqual(findMatchRanges('承認の記録', ' \n　'), [])
  assert.deepEqual(findMatchRanges('', '承認'), [])
})

test('query punctuation is literal and never interpreted as a regular expression', () => {
  const excerpt = 'a+b [承認] a.b a?b (案) \\path'
  for (const query of ['a+b', '[承認]', 'a.b', 'a?b', '(案)', '\\path']) {
    const start = excerpt.indexOf(query)
    assert.deepEqual(findMatchRanges(excerpt, query), [{ start, end: start + query.length }])
  }
  assert.deepEqual(findMatchRanges('aaab', 'a+b'), [])
})

test('match offsets remain safe for slicing emoji and case conversions of different lengths', () => {
  const excerpt = '🔎İ 承認 と TEST と test 🔎'
  assert.deepEqual(findMatchRanges(excerpt, '承認'), [{ start: 4, end: 6 }])
  const ranges = findMatchRanges(excerpt, 'test')
  assert.deepEqual(ranges, [{ start: 9, end: 13 }, { start: 16, end: 20 }])
  assert.deepEqual(ranges.map(({ start, end }) => excerpt.slice(start, end)), ['TEST', 'test'])
  assert.deepEqual(findMatchRanges('🔎🔎', '🔎'), [{ start: 0, end: 2 }, { start: 2, end: 4 }])
})

test('recent sessions contain the latest five and never mutate the source list', () => {
  const sessions = Object.freeze([
    { id: '古い', updatedAt: 10 },
    { id: '最新', updatedAt: 70 },
    { id: '四番目', updatedAt: 40 },
    { id: '六番目', updatedAt: 20 },
    { id: '三番目', updatedAt: 50 },
    { id: '五番目', updatedAt: 30 },
    { id: '二番目', updatedAt: 60 },
  ])
  const before = [...sessions]
  const recent = selectRecentSessions(sessions)
  assert.deepEqual(recent.map(session => session.id), ['最新', '二番目', '三番目', '四番目', '五番目'])
  assert.deepEqual(sessions, before)
  assert.equal(recent[0], sessions[1])
})

test('recent sessions accept smaller lists and respect an explicit limit', () => {
  const sessions = [{ id: '先', updatedAt: 1 }, { id: '後', updatedAt: 1 }]
  assert.deepEqual(selectRecentSessions(sessions), sessions)
  assert.notEqual(selectRecentSessions(sessions), sessions)
  assert.deepEqual(selectRecentSessions(sessions, 1), [sessions[0]])
  assert.deepEqual(selectRecentSessions(sessions, 0), [])
  assert.deepEqual(selectRecentSessions(sessions, -1), [])
  assert.deepEqual(selectRecentSessions([]), [])
})
