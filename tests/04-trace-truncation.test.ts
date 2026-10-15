import assert from 'node:assert/strict'
import test from 'node:test'
import type { SessionWireEvent } from '../web/src/dsh/services.ts'
import { mockRecord } from '../web/src/dsh/mock/record.ts'
import {
  CONTENT_BLOCK_LIMIT, JSON_DEPTH_LIMIT, JSON_NODE_LIMIT, JsonOmission, buildTrace, contentSearchText, contentText, formatJson,
  prettyJson, safeJsonCopy, searchTrace, type TraceInputBlock,
} from '../web/src/features/trace/model.ts'

const CYCLE = '〔循環参照のため省略〕'
const DEPTH = `〔入れ子が深すぎるため省略（${JSON_DEPTH_LIMIT} 段まで表示）〕`
const LIMIT = '〔以降を省略（10,000 要素まで表示）〕'
const UNREADABLE = '〔内容を表示できません〕'

function nested(levels: number): unknown {
  let value: unknown = {}
  for (let i = 0; i < levels; i++) value = { child: value }
  return value
}
function count(text: string, part: string): number { return text.split(part).length - 1 }

test('73-8 通常のJSONはJSON.stringify(value, null, 2)と同じ形に整形する', () => {
  const shared = { name: '共有' }
  const values: unknown[] = [
    // A top-level string is read as JSON text first, so strings are covered by the last check.
    null, true, 0, -1.5, [], {}, [[], {}, [1, [2, [3]]]],
    { a: 1, b: [true, null, 'x'], c: { d: {} }, '10': 'integer-like', 2: 'key order', 'quote"\n': '改行\nと"引用"' },
    { nan: Number.NaN, inf: Number.POSITIVE_INFINITY, missing: undefined, fn: () => 1, sym: Symbol('s') },
    [undefined, () => 1, Symbol('s'), Number.NaN],
    { first: shared, second: shared, list: [shared, shared] },
    { date: new Date(0), boxed: [new String('s'), new Number(2), new Boolean(false)] },
    JSON.parse('{"__proto__":{"polluted":true},"ok":1}'),
    { emoji: '😀', control: '\u0001', separator: '\u2028' },
  ]
  for (const value of values) {
    assert.equal(prettyJson(value), JSON.stringify(value, null, 2) ?? '', String(JSON.stringify(value)))
    assert.equal(formatJson(value).partial, false)
    assert.equal(prettyJson(JSON.stringify(value)), JSON.stringify(JSON.parse(JSON.stringify(value) ?? 'null'), null, 2))
  }
  assert.equal(prettyJson(undefined), '')
  assert.equal(prettyJson(JSON.stringify('省略')), '"省略"')
  assert.equal(prettyJson('JSONではない文字列'), 'JSONではない文字列')
})

test('73-8 安全な複製は元のデータと切り離され、__proto__ も普通のキーとして扱う', () => {
  const source = JSON.parse('{"__proto__":{"polluted":true},"list":[{"x":1}]}') as Record<string, unknown>
  const { value, omissions } = safeJsonCopy(source)
  assert.deepEqual(omissions, [])
  const copy = value as Record<string, unknown>
  assert.equal(Object.getPrototypeOf(copy), null)
  assert.deepEqual(Object.keys(copy), ['__proto__', 'list'])
  assert.notEqual(copy.list, source.list)
  assert.equal(({} as Record<string, unknown>).polluted, undefined)
})

test('73-7 実データの文字列「省略」と打ち切りの印を区別できる', () => {
  const real = prettyJson({ value: '省略' })
  assert.equal(real, '{\n  "value": "省略"\n}')
  assert.equal(formatJson({ value: '省略' }).partial, false)
  const cycle: Record<string, unknown> = { value: '省略' }
  cycle.self = cycle
  const cut = formatJson(cycle)
  assert.equal(cut.text, `{\n  "value": "省略",\n  "self": ${CYCLE}\n}`)
  assert.equal(cut.partial, true)
  assert.throws(() => JSON.parse(cut.text), '印はJSONの文字列にならない')
  const copied = safeJsonCopy(cycle).value as Record<string, unknown>
  assert.ok(copied.self instanceof JsonOmission)
  assert.equal(copied.value, '省略')
})

test('73-7 循環・深さ・要素数の打ち切りを理由ごとの印で示す', () => {
  const list: unknown[] = []
  list.push(list)
  assert.equal(prettyJson(list), `[\n  ${CYCLE}\n]`)

  // Same bound as before: an object at depth 64 is cut, depth 63 is shown.
  assert.equal(formatJson(nested(JSON_DEPTH_LIMIT - 1)).partial, false)
  const deep = formatJson(nested(JSON_DEPTH_LIMIT))
  assert.equal(deep.partial, true)
  assert.equal(count(deep.text, DEPTH), 1)
  assert.equal(count(deep.text, '"child"'), JSON_DEPTH_LIMIT)
  const veryDeep = formatJson(nested(20000))
  assert.equal(count(veryDeep.text, DEPTH), 1)
  assert.equal(count(veryDeep.text, '"child"'), JSON_DEPTH_LIMIT)

  const many = Array.from({ length: 20000 }, (_, index) => index)
  const limited = formatJson(many)
  assert.equal(limited.partial, true)
  assert.equal(count(limited.text, LIMIT), 1, '要素数の印は打ち切った位置に1つだけ出す')
  assert.ok(limited.text.includes(`  ${JSON_NODE_LIMIT - 2},\n  ${LIMIT}\n]`))
  assert.ok(!limited.text.includes(`  ${JSON_NODE_LIMIT - 1},`))
  assert.equal(formatJson(Array.from({ length: JSON_NODE_LIMIT - 1 }, () => 0)).partial, false)

  const all = safeJsonCopy({ deep: nested(100), cycle: list, many }).omissions
  assert.deepEqual([...all].sort(), ['cycle', 'depth', 'limit'])
})

test('73-7 要素数の上限で打ち切った後は、祖先の残りの要素も読まない', () => {
  let reads = 0
  const wide = new Proxy([] as unknown[], {
    get(target, key) {
      if (key === 'length') return 1e9
      if (typeof key === 'string' && /^\d+$/.test(key)) { reads++; return { index: Number(key) } }
      return Reflect.get(target, key)
    },
  })
  const result = formatJson({ wide, after: 'この値は読まない' })
  assert.equal(result.partial, true)
  assert.ok(reads <= JSON_NODE_LIMIT)
  assert.ok(!result.text.includes('この値は読まない'))
})

test('73-8 toJSON が新しいオブジェクトを返して元に戻る場合も循環として示す', () => {
  const owner: { toJSON(): unknown } = { toJSON: () => ({ again: owner }) }
  assert.equal(prettyJson(owner), `{\n  "again": ${CYCLE}\n}`)
  const shared = { leaf: 1 }
  assert.equal(formatJson({ a: shared, b: [shared] }).partial, false, '循環していない共有参照は省略しない')
})

test('73-7 整形できない値は専用の印にし、一部だけと扱う', () => {
  assert.deepEqual(formatJson({ value: 1n }), { text: UNREADABLE, partial: true })
  const broken = { get value() { throw new Error('synthetic getter failure') } }
  assert.deepEqual(formatJson(broken), { text: UNREADABLE, partial: true })
})

test('73-7 本文の探索で上限に達したら一部だけと示す', () => {
  const blocks = (length: number) => Array.from({ length }, (_, index) => ({ type: 'text', text: `本文${index}` })) as TraceInputBlock[]
  assert.deepEqual(contentSearchText(blocks(CONTENT_BLOCK_LIMIT)).partial, false)
  const over = contentSearchText(blocks(CONTENT_BLOCK_LIMIT + 1))
  assert.equal(over.partial, true)
  assert.ok(over.text.endsWith(`本文${CONTENT_BLOCK_LIMIT - 1}`))
  assert.equal(contentText(blocks(3)), '本文0\n本文1\n本文2')

  let deep: unknown = [{ type: 'text', text: '末端' }]
  for (let i = 0; i < 20000; i++) deep = [{ type: 'tool-output', content: deep }]
  const deepResult = contentSearchText(deep as TraceInputBlock[])
  assert.equal(deepResult.partial, true)
  assert.equal(deepResult.text, '')

  let shallow: unknown = [{ type: 'text', text: '末端' }]
  for (let i = 0; i < 10; i++) shallow = [{ type: 'tool-output', content: shallow }]
  assert.deepEqual(contentSearchText(shallow as TraceInputBlock[]), { text: '末端', partial: false })
})

function record(seq: number, type: string, data: SessionWireEvent['data'] = {}): SessionWireEvent {
  return mockRecord(seq, type, seq * 10, data)
}

test('73-7 検索は一部だけ検索した記録の数を返す', () => {
  const cycle: Record<string, unknown> = { path: 'docs/guide.md' }
  cycle.self = cycle
  const turns = buildTrace([
    record(1, 'turn/start', { turn: 1 }),
    record(2, 'tool/call', { turn: 1, callId: 'object', name: 'object_tool', arguments: cycle } as unknown as SessionWireEvent['data']),
    record(3, 'tool/call', { turn: 1, callId: 'string', name: 'string_tool', arguments: '{"path":"docs/guide.md"}' }),
    record(4, 'user/message', { turn: 1, content: Array.from({ length: CONTENT_BLOCK_LIMIT + 1 }, (_, index) => ({ type: 'text', text: `本文${index}` })) }),
    record(5, 'turn/end', { turn: 1 }),
  ])
  const rows = turns[0]!.rows
  assert.equal(rows[0]!.partialText, true)
  assert.ok(rows[0]!.arguments?.includes(CYCLE))
  assert.equal(rows[1]!.partialText, undefined)

  assert.equal(searchTrace(turns, '').partialRows, 0)
  const none = searchTrace(turns, '該当しない語')
  assert.deepEqual(none.turns.map(turn => turn.rows.length), [0])
  assert.equal(none.partialRows, 2, '引数を省略した行と、本文の上限を超えた行')
  const matched = searchTrace(turns, 'guide.md')
  assert.deepEqual(matched.turns[0]!.rows.map(row => row.callId), ['object', 'string'])
  assert.equal(matched.partialRows, 1, '一致した行は数えない')
})

test('73-7 要約とサブツールの引数も、省略したら一部だけと記録する', () => {
  const turns = buildTrace([
    record(1, 'turn/start', { turn: 1 }),
    record(2, 'compaction/start', { turn: 1, compactionId: 'c' }),
    record(3, 'compaction/summary', { turn: 1, compactionId: 'c', summary: nested(100) } as unknown as SessionWireEvent['data']),
    record(4, 'compaction/summary', { turn: 1, compactionId: 'plain', summary: '{"not":"reformatted"}' }),
    record(5, 'tool/ptc-dispatch', { turn: 1, subCallId: 's', name: 'sub', arguments: nested(100) } as unknown as SessionWireEvent['data']),
    record(6, 'turn/end', { turn: 1 }),
  ])
  const [summary, plain, sub] = turns[0]!.rows
  assert.equal(summary!.partialText, true)
  assert.ok(contentText(summary!.content).includes(DEPTH))
  assert.equal(plain!.partialText, undefined)
  assert.equal(contentText(plain!.content), '{"not":"reformatted"}')
  assert.equal(sub!.partialText, true)
  assert.ok(sub!.arguments?.includes(DEPTH))
})
