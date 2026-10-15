import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeSchema, schemaFields, type SettingField, type SettingsNamespace } from '../web/src/features/settings/schema.ts'
import { settingFieldAccess } from '../web/src/features/settings/field-access.ts'

// Issue #77: 73-1 (graceful degradation at the schema limits) and 73-2 (read-only decoded nodes).
const row = (schema: unknown, value: SettingsNamespace['value'] = {}, extra: Partial<SettingsNamespace> = {}): SettingsNamespace =>
  ({ ns: 'synthetic-limits', autoGenerate: true, revision: 1, applies: 'live', schema, value, user: {}, ...extra })
const leaves = (fields: SettingField[]): SettingField[] => fields.flatMap(field => field.children ? leaves(field.children) : [field])
const notices = (fields: SettingField[]) => fields.filter(field => field.omitted && field.path.length === 0)

test('深すぎる定義はそのノードだけを省略し、前後の項目は値つきで編集できる', () => {
  const refs: Record<string, unknown> = { root: { type: 'object', dict: { before: 's', deep: 'd0', after: 'n' } }, s: { type: 'string' }, n: { type: 'number' } }
  for (let i = 0; i < 40; i++) refs[`d${i}`] = { type: 'object', dict: { child: `d${i + 1}` } }
  refs.d40 = { type: 'string', meta: { role: 'password' } }
  let deepValue: Record<string, unknown> = { child: 'synthetic-deep-secret' }
  for (let i = 0; i < 40; i++) deepValue = { child: deepValue }
  const fields = schemaFields(row({ uid: 'root', refs }, { before: '前', after: 2, deep: deepValue as never }))
  assert.deepEqual(fields.map(field => [field.path, field.kind, field.value]), [[['before'], 'text', '前'], [['deep'], 'group', undefined], [['after'], 'number', 2]])
  assert.equal(notices(fields).length, 0)
  const omitted = leaves(fields).filter(field => field.omitted)
  assert.equal(omitted.length, 1, 'only the node beyond the depth limit is omitted')
  assert.ok(omitted[0]!.path.length > 30)
  assert.match(omitted[0]!.description, /標準の画面/)
  assert.ok(!JSON.stringify(fields).includes('synthetic-deep-secret'))
})

test('項目数の上限では先頭の項目を表示し、残りを標準の画面へ案内する', () => {
  const dict = Object.fromEntries(Array.from({ length: 600 }, (_, index) => [`field${index}`, 1]))
  const fields = schemaFields(row({ uid: 0, refs: { 0: { type: 'object', dict }, 1: { type: 'string' } } }, { field0: '最初', field511: '最後に表示', field599: 'synthetic-unshown' }))
  assert.equal(fields.length, 513)
  assert.deepEqual([fields[0]!.kind, fields[0]!.value, fields[511]!.value], ['text', '最初', '最後に表示'])
  assert.equal(notices(fields).length, 1)
  assert.equal(fields[512]!.label, '表示していない項目')
  assert.equal(fields[512]!.description, '設定の項目や値が多いため、先頭の 512 項目だけを表示しています。残りの項目は標準の画面で確認してください。')
  assert.ok(!JSON.stringify(fields).includes('synthetic-unshown'))
})

test('ノード数の上限を超えても、上限より前の項目は表示する', () => {
  const refs: Record<string, unknown> = { root: { type: 'object', dict: { first: 's', big: 'big', after: 's' } }, s: { type: 'string' } }
  const big: Record<string, string> = {}
  for (let i = 0; i < 1100; i++) { big[`k${i}`] = `n${i}`; refs[`n${i}`] = { type: 'boolean' } }
  refs.big = { type: 'object', dict: big }
  const decoded = decodeSchema({ uid: 'root', refs })
  assert.equal(decoded.truncated, undefined)
  assert.ok(Object.values(decoded.dict!.big!.dict!).some(node => node.truncated), 'nodes beyond the limit are marked individually')
  const fields = schemaFields(row({ uid: 'root', refs }, { first: '先頭' }))
  assert.deepEqual(fields.map(field => [field.path, field.value]), [[['first'], '先頭'], [[], undefined]])
  assert.match(fields[1]!.description, /先頭の 1 項目/)
})

test('共有参照が指数的に広がる項目は、その項目以降を案内に置き換え、先の項目は残す', () => {
  const refs: Record<string, unknown> = { root: { type: 'object', dict: { first: 's', wide: 'x0' } }, s: { type: 'string' }, x20: { type: 'boolean' } }
  for (let i = 0; i < 20; i++) refs[`x${i}`] = { type: 'object', dict: { a: `x${i + 1}`, b: `x${i + 1}` } }
  const started = performance.now()
  const fields = schemaFields(row({ uid: 'root', refs }, { first: '一' }))
  assert.ok(performance.now() - started < 2000)
  assert.deepEqual(fields.map(field => [field.path, field.value, field.omitted === true]), [[['first'], '一', false], [[], undefined, true]])
})

test('同じ定義の交差は1つの項目にまとめ、指数的な交差でも表示できる', () => {
  const refs: Record<string, unknown> = { 16: { type: 'object', dict: { enabled: 17 } }, 17: { type: 'boolean' } }
  for (let i = 15; i >= 0; i--) refs[i] = { type: 'intersect', list: [i + 1, i + 1] }
  const fields = schemaFields(row({ uid: 0, refs }, { enabled: true }))
  assert.deepEqual(fields.map(field => [field.path, field.kind, field.value]), [[['enabled'], 'switch', true]])
})

test('利用者の値が多くても保護の検査を打ち切らず、カスタムの提供元10件×モデル10件を表示する', () => {
  // Shape of llm-pi-ai: providers is a dictionary of profiles, each with a dictionary of models (about 56 nodes each).
  const refs: Record<string, unknown> = {
    root: { type: 'object', dict: { providers: 'providers' } }, providers: { type: 'dict', inner: 'profile' },
    profile: { type: 'object', dict: { apiKey: 'secret', models: 'models' } }, secret: { type: 'string', meta: { role: 'password' } },
    models: { type: 'dict', inner: 'model' }, s: { type: 'string' },
    model: { type: 'object', dict: Object.fromEntries(Array.from({ length: 55 }, (_, index) => [`m${index}`, 's'])) },
  }
  const providers = Object.fromEntries(Array.from({ length: 10 }, (_, p) => [`p${p}`, { apiKey: `synthetic-key-${p}`, models: Object.fromEntries(Array.from({ length: 10 }, (_, m) => [`model${m}`, { m0: 'モデル' }])) }]))
  const fields = schemaFields(row({ uid: 'root', refs }, { providers }))
  assert.equal(fields.length, 1)
  assert.equal(fields[0]!.omitted, undefined)
  assert.ok(JSON.stringify(fields[0]!.value).includes('モデル'))
  assert.ok(!JSON.stringify(fields).includes('synthetic-key'))
})

test('保護の検査が上限に達した項目以降は値を出さず、それより前の項目は表示する', () => {
  const refs: Record<string, unknown> = {
    root: { type: 'object', dict: { first: 's', list: 'list', after: 's' } }, s: { type: 'string' },
    list: { type: 'dict', inner: 'entry' }, entry: { type: 'object', dict: { token: 'secret', note: 's' } }, secret: { type: 'string', meta: { role: 'password' } },
  }
  const list = Object.fromEntries(Array.from({ length: 20000 }, (_, index) => [`e${index}`, { token: `synthetic-token-${index}`, note: '注記' }]))
  const fields = schemaFields(row({ uid: 'root', refs }, { first: '一', list, after: 'synthetic-after' }))
  assert.deepEqual(fields.map(field => [field.path, field.value]), [[['first'], '一'], [[], undefined]])
  assert.ok(!JSON.stringify(fields).includes('synthetic-token'))
  assert.ok(!JSON.stringify(fields).includes('synthetic-after'))
})

test('大きすぎる値はその項目だけを省略し、後ろの通常の項目は表示する', () => {
  const refs = { root: { type: 'object', dict: { list: 'list', after: 's' } }, s: { type: 'string' }, list: { type: 'array', inner: 's' } }
  const fields = schemaFields(row({ uid: 'root', refs }, { list: Array.from({ length: 40000 }, () => 'synthetic-large'), after: '後ろ' }))
  assert.deepEqual(fields.map(field => [field.path, field.kind, field.omitted === true, field.value]), [[['list'], 'readonly', true, undefined], [['after'], 'text', false, '後ろ']])
  assert.match(fields[0]!.description, /値が大きいため/)
  assert.ok(!JSON.stringify(fields).includes('synthetic-large'))
})

test('循環で打ち切った深い位置にあるpasswordの値を読み取り専用の親から出さない', () => {
  const schema = { uid: 0, refs: {
    0: { type: 'object', dict: { first: 1, second: 2 } },
    1: { type: 'object', dict: { secret: 3, children: 2 } },
    2: { type: 'array', inner: 1 }, 3: { type: 'string', meta: { role: 'password' } },
  } }
  const value = {
    first: { secret: 'synthetic-first', children: [{ secret: 'synthetic-deep-first', children: [] }] },
    second: [{ secret: 'synthetic-second', children: [{ secret: 'synthetic-deep-second', children: [] }] }],
  }
  const fields = schemaFields(row(schema, value))
  assert.doesNotMatch(JSON.stringify(fields), /synthetic-/)
  assert.deepEqual(leaves(fields).map(field => [field.path, field.kind, field.omitted === true]), [
    [['first', 'secret'], 'masked', false], [['first', 'children'], 'readonly', true], [['second'], 'readonly', true],
  ])
})

test('交差の後ろのメンバーが宣言したpasswordも、前のメンバーの同じ項目に適用する', () => {
  const schema = { uid: 0, refs: { 0: { type: 'intersect', list: [1, 2] }, 1: { type: 'object', dict: { token: 3 } }, 2: { type: 'object', dict: { token: 4 } }, 3: { type: 'string' }, 4: { type: 'string', meta: { role: 'password' } } } }
  const fields = schemaFields(row(schema, { token: 'synthetic-token' }))
  assert.deepEqual(fields.map(field => field.kind), ['masked', 'masked'])
  assert.doesNotMatch(JSON.stringify(fields), /synthetic-token/)
})

test('復号したノードは読み取り専用で、共有されたまま変更できない（73-2）', () => {
  const input = { uid: 0, refs: { 0: { type: 'object', dict: { first: 1, second: 1 } }, 1: { type: 'string', meta: { title: '名前' } } } }
  const decoded = decodeSchema(input)
  assert.equal(decoded.dict!.first, decoded.dict!.second)
  for (const node of [decoded, decoded.dict, decoded.dict!.first, decoded.dict!.first!.meta]) assert.ok(Object.isFrozen(node))
  assert.throws(() => { (decoded.dict!.first as { type?: string }).type = 'number' }, TypeError)
  assert.throws(() => { (decoded.dict!.first!.meta as { title?: string }).title = '変更' }, TypeError)
  assert.equal(decodeSchema(input).dict!.second!.type, 'string')
  // The caller's document is copied, never frozen.
  assert.equal(Object.isFrozen(input.refs[1].meta), false)
  input.refs[1].meta.title = '呼び出し側の変更'
  assert.equal(decoded.dict!.first!.meta!.title, '名前')
})

test('既定値に戻す判定は、指数的な共有定義で止まらず、省略した定義を含むまとまりを戻さない', () => {
  const refs: Record<string, unknown> = { root: { type: 'object', dict: { name: 's', wide: 'x0' } }, s: { type: 'string' }, x30: { type: 'boolean' } }
  for (let i = 0; i < 30; i++) refs[`x${i}`] = { type: 'object', dict: { a: `x${i + 1}`, b: `x${i + 1}` } }
  const started = performance.now()
  const access = settingFieldAccess(row({ uid: 'root', refs }), { path: ['name'], kind: 'text', label: '', description: '', overridden: true, disabled: false, required: false })
  assert.ok(performance.now() - started < 2000)
  assert.deepEqual(access, { edit: true, reset: false, resetBlocked: true })

  const loop = { uid: 0, refs: { 0: { type: 'object', dict: { tree: 1, name: 2 } }, 1: { type: 'object', dict: { label: 2, child: 1 } }, 2: { type: 'string' } } }
  const group = { path: ['tree'], kind: 'group' as const, label: '', description: '', overridden: true, disabled: false, required: false }
  assert.deepEqual(settingFieldAccess(row(loop), group), { edit: false, reset: false, resetBlocked: true })
  assert.deepEqual(settingFieldAccess(row(loop), { ...group, path: ['name'], kind: 'text' }), { edit: true, reset: true, resetBlocked: false })
})
