import assert from 'node:assert/strict'
import test from 'node:test'
import { cacheHit, catalogEntries, catalogRows, childAddress, contextPercent, formatTokens, hasChildren, maxTurn, menuActions, reasoningLabel, runningJobCount } from '../web/src/features/session-tools/presentation.ts'
import type { SessionJob, SessionSummary, SessionWireEvent, SessionProjectionSnapshot } from '../web/src/dsh/services.ts'

test('コンテキストは pressure を優先し、欠けたときのみ projected に戻る', () => {
  assert.equal(contextPercent({ pressureTokens: 62000, projectedTokens: 70000, contextWindow: 100000 }), 62)
  assert.equal(contextPercent({ projectedTokens: 62000, contextWindow: 100000 }), 62)
  assert.equal(contextPercent({ pressureTokens: 0, projectedTokens: 100, contextWindow: 100 }), 0)
  assert.equal(contextPercent({ pressureTokens: 120, contextWindow: 100 }), 120)
  for (const value of [undefined, null, {}, { pressureTokens: 1 }, { pressureTokens: 1, contextWindow: 0 }, { pressureTokens: -1, contextWindow: 100 }, { pressureTokens: NaN, contextWindow: 100 }, { pressureTokens: 1, contextWindow: Infinity }]) assert.equal(contextPercent(value), undefined)
})
test('キャッシュヒット率は標準の画面と同じ分母・丸めで、入力がなければ出さない', () => {
  const usage = (uncachedInputTokens: number, cacheReadTokens: number, cacheWriteTokens: number) => ({ uncachedInputTokens, outputTokens: 5, cacheReadTokens, cacheWriteTokens })
  // Denominator is uncached input + cache read + cache write.
  assert.deepEqual(cacheHit(usage(11668, 15400, 2048)), { value: 53, fractionDigits: 0 })
  assert.deepEqual(cacheHit(usage(50, 50, 0)), { value: 50, fractionDigits: 0 })
  assert.deepEqual(cacheHit(usage(0, 0, 100)), { value: 0, fractionDigits: 0 })
  // Ties round up.
  assert.deepEqual(cacheHit(usage(1, 1, 0)), { value: 50, fractionDigits: 0 })
  assert.deepEqual(cacheHit(usage(199, 1, 0)), { value: 1, fractionDigits: 0 })
  // A full hit is 100; a partial hit never rounds up to 100.
  assert.deepEqual(cacheHit(usage(0, 1234, 0)), { value: 100, fractionDigits: 0 })
  assert.deepEqual(cacheHit(usage(1, 199, 0)), { value: 99.5, fractionDigits: 1 })
  assert.deepEqual(cacheHit(usage(1, 999, 0)), { value: 99.9, fractionDigits: 1 })
  assert.deepEqual(cacheHit(usage(1, 99999, 0)), { value: 99.999, fractionDigits: 3 })
  assert.deepEqual(cacheHit(usage(1, 1_000_000_000_000, 0)), { value: 99.9999999999, fractionDigits: 10 })
  // No input, or any input-side bucket missing or invalid: nothing to show.
  for (const value of [undefined, null, {}, usage(0, 0, 0), { cacheReadTokens: 1, cacheWriteTokens: 0 }, { uncachedInputTokens: 1, cacheWriteTokens: 0 }, { uncachedInputTokens: 1, cacheReadTokens: 0 },
    usage(NaN, 1, 0), usage(1, Infinity, 0), usage(1, 1, -1), usage(1.5, 1, 0)]) assert.equal(cacheHit(value), undefined)
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
  const catalog = { state: 'ready', error: null, values: { subagentCatalog: [{ id: child.id, mode: child.mode, label: child.label, createdAt: 0 }, { id: 'bad', mode: 'unknown', createdAt: 0 }, { id: 'malformed' }, { id: 'outside', mode: 'external', label: '別の実行先', createdAt: 0 }] } } as SessionProjectionSnapshot
  assert.equal(catalogEntries(catalog).length, 3)
  assert.deepEqual(catalogEntries(catalog), [child, { kind: 'diagnostic', id: 'bad' }, { kind: 'external', id: 'outside', label: '別の実行先' }])
  const converted = catalogEntries(catalog)[0]!
  assert.equal(converted.kind, 'child')
  if (converted.kind === 'child') assert.deepEqual(childAddress('parent', converted), { parentSessionId: 'parent', childSessionId: 'child', mode: 'continuable' })
  const once = catalogEntries({ ...catalog, values: { subagentCatalog: [{ id: 'once', mode: 'one-shot', label: '一度限り', createdAt: 0 }] } })[0]!
  assert.deepEqual(once, { kind: 'child', id: 'once', mode: 'one-shot', label: '一度限り', activity: 'inactive' })
  if (once.kind === 'child') assert.deepEqual(childAddress('parent', once), { parentSessionId: 'parent', childSessionId: 'once', mode: 'one-shot' })
  assert.equal(catalogEntries(catalog)[2]!.kind, 'external')
  assert.equal(hasChildren('parent', catalog, {}), true)
  assert.deepEqual(childAddress('parent', child), { parentSessionId: 'parent', childSessionId: 'child', mode: 'continuable' })
  assert.equal(hasChildren('parent', { state: 'ready', error: null, values: { subagentCatalog: [{ id: 'bad', mode: 'unknown', createdAt: 0 }] } }, {}), false)
  const summary: SessionSummary = { id: 'child', displayTitle: '子', origin: 'subagent', parentId: 'parent', retainedBy: {}, running: false, blank: false, updatedAt: 0 }
  assert.equal(hasChildren('parent', undefined, { child: summary }), true)
  assert.equal(hasChildren('another', undefined, { child: summary }), false)
})
test('external の行はラベル欠けで既定語に落ち、開かせる Child にはならない', () => {
  const catalog = { state: 'ready', error: null, values: { subagentCatalog: [{ id: 'no-label', mode: 'external', createdAt: 0 }, { id: 'labeled', mode: 'external', label: '外部での実行', createdAt: 0 }] } } as SessionProjectionSnapshot
  assert.deepEqual(catalogEntries(catalog), [{ kind: 'external', id: 'no-label' }, { kind: 'external', id: 'labeled', label: '外部での実行' }])
  assert.deepEqual(catalogRows(catalogEntries(catalog)), { children: [], externals: [{ kind: 'external', id: 'no-label' }, { kind: 'external', id: 'labeled', label: '外部での実行' }], diagnosticCount: 0 })
  assert.equal(hasChildren('parent', catalog, {}), true)
})
test('移行待ちの形式は子の行に印を付け、開ける子の型は変わらない', () => {
  const summary: SessionSummary = { id: 'child', displayTitle: '子', origin: 'subagent', parentId: 'parent', retainedBy: {}, running: false, blank: false, updatedAt: 0, formatStatus: 'migration-required' }
  const catalog = { state: 'ready', error: null, values: { subagentCatalog: [{ id: 'child', mode: 'one-shot', label: '調査', createdAt: 0 }] } } as SessionProjectionSnapshot
  assert.deepEqual(catalogEntries(catalog, { child: summary }), [{ kind: 'child', id: 'child', mode: 'one-shot', label: '調査', activity: 'inactive', migrationRequired: true }])
  assert.deepEqual(catalogEntries(catalog), [{ kind: 'child', id: 'child', mode: 'one-shot', label: '調査', activity: 'inactive' }])
  const entry = catalogEntries(catalog, { child: summary })[0]!
  if (entry.kind === 'child') assert.deepEqual(childAddress('parent', entry), { parentSessionId: 'parent', childSessionId: 'child', mode: 'one-shot' })
})
test('ジョブのメニュー件数は一覧と同じ実行中・停止中を数える', () => {
  const jobs = ['running', 'stopping', 'completed', 'failed', 'killed'].map((status, index) => ({ id: String(index), kind: 'bash', label: '処理', status, startedAt: 0 })) as SessionJob[]
  assert.equal(runningJobCount(jobs), 2)
  assert.equal(runningJobCount(), 0)
  assert.equal(runningJobCount(jobs.filter(job => job.status === 'completed')), 0)
})
test('複数の読めない記録は件数にまとめ、子の行と順序は維持する', () => {
  const children = [
    { kind: 'child', id: 'child-1', activity: 'running', mode: 'continuable' },
    { kind: 'child', id: 'child-2', activity: 'inactive', mode: 'one-shot' },
  ] as const
  assert.deepEqual(catalogRows([children[0], { kind: 'diagnostic', id: 'bad-1' }, { kind: 'external', id: 'x' }, children[1], { kind: 'diagnostic', id: 'bad-2' }]),
    { children, externals: [{ kind: 'external', id: 'x' }], diagnosticCount: 2 })
  assert.deepEqual(catalogRows([{ kind: 'diagnostic', id: 'bad' }]), { children: [], externals: [], diagnosticCount: 1 })
  assert.deepEqual(catalogRows([]), { children: [], externals: [], diagnosticCount: 0 })
})
