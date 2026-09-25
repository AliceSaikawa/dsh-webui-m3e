import assert from 'node:assert/strict'
import test from 'node:test'
import { catalogEntries, childAddress, contextPercent, formatTokens, hasChildren, maxTurn, menuActions, reasoningLabel, runningJobCount } from '../web/src/features/session-tools/presentation.ts'
import type { SessionJob, SessionSummary, SessionWireEvent, SubagentCatalogSnapshot } from '../web/src/dsh/services.ts'

test('コンテキストは pressure を優先し、欠けたときのみ projected に戻る', () => {
  assert.equal(contextPercent({ pressureTokens: 62000, projectedTokens: 70000, contextWindow: 100000 }), 62)
  assert.equal(contextPercent({ projectedTokens: 62000, contextWindow: 100000 }), 62)
  assert.equal(contextPercent({ pressureTokens: 0, projectedTokens: 100, contextWindow: 100 }), 0)
  assert.equal(contextPercent({ pressureTokens: 120, contextWindow: 100 }), 120)
  for (const value of [undefined, null, {}, { pressureTokens: 1 }, { pressureTokens: 1, contextWindow: 0 }, { pressureTokens: -1, contextWindow: 100 }, { pressureTokens: NaN, contextWindow: 100 }, { pressureTokens: 1, contextWindow: Infinity }]) assert.equal(contextPercent(value), undefined)
})
test('トークンは万単位と未取得を区別する', () => {
  assert.equal(formatTokens(0), '0')
  assert.equal(formatTokens(9999), '9,999')
  assert.equal(formatTokens(10000), '1 万')
  assert.equal(formatTokens(12480), '1.2 万')
  for (const value of [undefined, NaN, Infinity, -1]) assert.equal(formatTokens(value), '未取得')
})
test('ターン数は読み込んだ開始番号の最大値で、件数ではない', () => {
  const records = [
    { type: 'turn/start', seq: 0, time: 0, data: { turn: 3 } },
    { type: 'turn/start', seq: 1, time: 1, data: { turn: 2 } },
    { type: 'turn/end', seq: 2, time: 2, data: { turn: 8 } },
    { type: 'turn/start', seq: 3, time: 3, data: { turn: '9' } },
  ] satisfies SessionWireEvent[]
  assert.equal(maxTurn(records), 3)
  assert.equal(maxTurn([]), 0)
  assert.equal(reasoningLabel('xhigh'), 'とても高い')
  assert.equal(reasoningLabel('future'), '指定あり')
})
test('メニューは子とゴールが存在するときだけ7項目になる', () => {
  assert.deepEqual(menuActions(false, null), ['rename', 'stats', 'files', 'jobs', 'archive'])
  assert.deepEqual(menuActions(true, {}), ['rename', 'stats', 'files', 'jobs', 'subagents', 'goal', 'archive'])
  assert.equal(menuActions(true, null).includes('goal'), false)
  assert.equal(menuActions(false, {}).includes('subagents'), false)
})
test('子カタログを絞り込み、会話へ mode を保ったアドレスを渡す', () => {
  const child = { kind: 'child', id: 'child', activity: 'inactive', mode: 'continuable', label: '調査' } as const
  const catalog: SubagentCatalogSnapshot = { state: 'ready', error: null, entries: [child, { kind: 'diagnostic', id: 'bad' }, { kind: 'child', id: 'malformed' }] }
  assert.equal(catalogEntries(catalog).length, 2)
  assert.equal(hasChildren('parent', catalog, {}), true)
  assert.deepEqual(childAddress('parent', child), { parentSessionId: 'parent', childSessionId: 'child', mode: 'continuable' })
  assert.equal(hasChildren('parent', { state: 'ready', error: null, entries: [{ kind: 'diagnostic', id: 'bad' }] }, {}), false)
  const summary: SessionSummary = { id: 'child', displayTitle: '子', origin: 'subagent', parentId: 'parent', running: false, blank: false, updatedAt: 0 }
  assert.equal(hasChildren('parent', undefined, { child: summary }), true)
  assert.equal(hasChildren('another', undefined, { child: summary }), false)
})
test('ジョブのメニュー件数は実行中のみ', () => {
  const jobs = ['running', 'stopping', 'completed', 'failed', 'killed'].map((status, index) => ({ id: String(index), kind: 'bash', label: '処理', status, startedAt: 0 })) as SessionJob[]
  assert.equal(runningJobCount(jobs), 1)
  assert.equal(runningJobCount(), 0)
})
