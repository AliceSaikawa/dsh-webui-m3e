import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeSchema, schemaFields, type SettingsNamespace } from '../web/src/features/settings/schema.ts'
import { createSettingsStore, fieldKey, type SettingsApi } from '../web/src/features/settings/store.ts'
import { InteractionStore, registerInteractionHandlers, type InteractionContext, type UserQuestionProjection } from '../web/src/dsh/interactions-store.ts'
import { blocks, contentText, prettyJson, type TraceInputBlock } from '../web/src/features/trace/model.ts'

const row: SettingsNamespace = { ns: 'agent-loop', autoGenerate: true, revision: 1, applies: 'live', schema: { uid: 0, refs: { 0: { type: 'object', dict: { enabled: 1 } }, 1: { type: 'boolean' } } }, value: { enabled: false }, user: {} }
const success = <T>(value: T) => ({ ok: true as const, value })
const flush = () => new Promise(resolve => setImmediate(resolve))

test('循環する共有スキーマからpasswordの値を露出しない', () => {
  const schema = { uid: 0, refs: {
    0: { type: 'object', dict: { first: 1, second: 2 } },
    1: { type: 'object', dict: { secret: 3, children: 2 } },
    2: { type: 'array', inner: 1 }, 3: { type: 'string', meta: { role: 'password' } },
  } }
  const value = { first: { secret: 'synthetic-first', children: [] }, second: [{ secret: 'synthetic-second', children: [] }] }
  const fields = schemaFields({ ...row, schema, value })
  assert.ok(!JSON.stringify(fields).includes('synthetic-first'))
  assert.ok(!JSON.stringify(fields).includes('synthetic-second'))
})

test('JSON文字列を一度だけ解釈して文字列の型を維持する', () => {
  for (const value of ['123', 'true', 'null', '{"value":1}', '普通の文字列']) {
    assert.equal(prettyJson(JSON.stringify(value)), JSON.stringify(value, null, 2))
  }
})
function api(overrides: Partial<SettingsApi> = {}): SettingsApi {
  return { describe: async () => success({ writable: true, namespaces: [row] }), update: async () => success(row), mutate: async () => success(row), ...overrides }
}

test('小さい共有参照スキーマを指数的に複製せず、描画する項目数も制限する', () => {
  const refs: Record<string, unknown> = { 16: { type: 'object', dict: { enabled: 17 } }, 17: { type: 'boolean' } }
  for (let i = 15; i >= 0; i--) refs[i] = { type: 'intersect', list: [i + 1, i + 1] }
  const schema = { uid: 0, refs }
  const decoded = decodeSchema(schema)
  assert.ok(decoded.list?.[0] === decoded.list?.[1], '共有の参照は同じ復号済みノードを使う')
  const fields = schemaFields({ ...row, schema })
  let count = 0
  const walk = (items: typeof fields) => { for (const item of items) { count++; if (item.children) walk(item.children) } }
  walk(fields)
  assert.ok(count <= 1024, `too many fields: ${count}`)
})

test('不正な質問projectionとinboxを無視し、有効な質問だけ残す', () => {
  const store = new InteractionStore()
  const answer = async () => true
  for (const active of [null, {}, 'bad', 1, [null, {}, { state: 'continued', callId: 'bad', questions: null }]]) {
    assert.doesNotThrow(() => store.syncQuestions('session', { active, settled: [] } as unknown as UserQuestionProjection, { 'next-step': {} }, answer))
    assert.deepEqual(store.getSnapshot(), [])
  }
  store.syncQuestions('session', { active: [null, { callId: 'valid', state: 'continued', questions: [{ id: 'q', question: '続けますか' }] }] } as unknown as UserQuestionProjection, null, answer)
  assert.equal(store.getSnapshot().length, 1)
})

test('質問初期化の途中で購読が例外になっても登録済みのhandlerと購読を全て解放する', () => {
  let handlers = 0, subscriptions = 0
  const face = { getSnapshot: () => ({ active: [], settled: [] }), subscribe: () => { subscriptions++; return () => { subscriptions-- } } }
  const broken = { getSnapshot: () => ({}), subscribe: () => { throw new Error('fixture subscribe failure') } }
  const ctx = { remote: { $on: () => { handlers++; return () => { handlers-- } } }, sessions: {
    scopeOf() {}, list: { getSnapshot: () => ({ byId: { session: {} } }), subscribe: () => () => {} },
    binding: () => ({ session: { projections: { faceOf: (name: string) => name === 'userQuestions' ? face : broken } } }),
  } } as unknown as InteractionContext
  assert.throws(() => registerInteractionHandlers(ctx, new InteractionStore()), /fixture subscribe failure/)
  assert.equal(handlers, 0)
  assert.equal(subscriptions, 0)
})

test('トレースの不正な画像を除外し、深い出力でも本文検索が例外にならない', () => {
  assert.deepEqual(blocks([{ type: 'image', attachment: null }, { type: 'text', text: '有効な本文' }]), [{ type: 'text', text: '有効な本文' }])
  assert.doesNotThrow(() => contentText([{ type: 'image', attachment: null }] as unknown as TraceInputBlock[]))
  let content: unknown = [{ type: 'text', text: '末端' }]
  for (let i = 0; i < 20000; i++) content = [{ type: 'tool-output', content }]
  assert.doesNotThrow(() => contentText(content as TraceInputBlock[]))
})

test('深い・循環したツール引数でもJSON整形が例外にならない', () => {
  let deep: unknown = '末端'
  for (let i = 0; i < 20000; i++) deep = { child: deep }
  assert.doesNotThrow(() => prettyJson(deep))
  const cycle: { child?: unknown } = {}; cycle.child = cycle
  assert.doesNotThrow(() => prettyJson(cycle))
})

test('設定更新通知200件を1件の読込と1回の追読にまとめる', async () => {
  let calls = 0
  const pending: ((value: ReturnType<typeof success<{ writable: boolean; namespaces: SettingsNamespace[] }>>) => void)[] = []
  const store = createSettingsStore(api({ describe: () => ++calls === 1 ? Promise.resolve(success({ writable: true, namespaces: [row] })) : new Promise(resolve => pending.push(resolve)) }))
  await store.reload()
  for (let i = 0; i < 200; i++) store.documentUpdated(row.ns, i + 2)
  assert.equal(calls, 2, 'only one new read runs while it is pending')
  pending[0]!(success({ writable: true, namespaces: [{ ...row, revision: 2 }] })); await flush()
  assert.equal(calls, 3)
  pending[1]!(success({ writable: true, namespaces: [{ ...row, revision: 201 }] })); await flush()
  assert.equal(calls, 3)
  assert.equal(store.getSnapshot().namespaces[0]!.revision, 201)
})

test('日本語を含むHost診断も保存エラーへそのまま表示しない', async () => {
  const diagnostic = '入力値 synthetic-private-value を /synthetic/internal/path で拒否'
  const store = createSettingsStore(api({ update: async () => ({ ok: false, error: { code: 'settings/rejected', message: diagnostic, details: {} } }) }))
  await store.reload(); assert.equal(await store.edit(row.ns, ['enabled'], true), false)
  const message = store.getSnapshot().fieldErrors[fieldKey(row.ns, ['enabled'])]
  assert.equal(message, 'この値は設定できません。入力内容を確認してください。')
  assert.ok(!JSON.stringify(store.getSnapshot()).includes(diagnostic))
})

test('普通の共有スキーマは別々の項目を保ち、上限で打ち切ると未検査の値を出さない', () => {
  const schema = { uid: 0, refs: { 0: { type: 'object', dict: { first: 1, second: 1, hidden: 2 } }, 1: { type: 'string' }, 2: { type: 'string', meta: { role: 'password' } } } }
  const fields = schemaFields({ ...row, schema, value: { first: '一', second: '二', hidden: 'synthetic-hidden' } })
  assert.deepEqual(fields.map(field => [field.path, field.kind, field.value]), [[['first'], 'text', '一'], [['second'], 'text', '二'], [['hidden'], 'masked', undefined]])
  const dict = Object.fromEntries(Array.from({ length: 5000 }, (_, index) => [`field${index}`, 1]))
  const huge = schemaFields({ ...row, schema: { uid: 0, refs: { 0: { type: 'object', dict }, 1: { type: 'string' } } }, value: { hidden: 'synthetic-hidden' } })
  assert.equal(huge.length, 1)
  assert.equal(huge[0]!.disabled, true)
  assert.equal(huge[0]!.value, undefined)
  assert.ok(!JSON.stringify(huge).includes('synthetic-hidden'))
})

test('トレースの通常の本文・画像・JSONは維持する', () => {
  const attachment = { attachmentId: 'synthetic-image', name: '試験画像', mediaType: 'image/png', width: 1, height: 1, bytes: 10 }
  const content = [{ type: 'text', text: '本文' }, { type: 'image', attachment }, { type: 'tool-call', name: 'bash', arguments: '{}' }]
  assert.deepEqual(blocks(content), content)
  assert.equal(contentText(blocks(content)), '本文\n試験画像\nbash {}')
  assert.equal(prettyJson({ value: [1, 2] }), JSON.stringify({ value: [1, 2] }, null, 2))
})
