import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPatch, buildReset, decodeSchema, formatSetting, groupNamespaces, pageSummary, parseFieldInput, schemaFields, selectFieldState, valueAt,
  type SettingField, type SettingsNamespace,
} from '../web/src/features/settings/schema.ts'

function namespace(overrides: Partial<SettingsNamespace> = {}): SettingsNamespace {
  return {
    ns: 'agent-loop', revision: 7, schema: { uid: 1, refs: { 1: { type: 'object', dict: {} } } },
    value: {}, base: {}, user: {}, applies: 'live', ...overrides,
  }
}

const editorSchema = {
  uid: 1,
  refs: {
    1: { type: 'object', dict: { enabled: 2, name: 3, count: 4, mode: 5, retry: 9, list: 12, map: 13, future: 14, mixed: 15 } },
    2: { type: 'boolean', meta: { title: '実行する', description: '自動で実行します。' } },
    3: { type: 'string', meta: { required: true } },
    4: { type: 'number', meta: { min: 1, max: 9, step: 2 } },
    5: { type: 'union', list: [6, 7, 8] },
    6: { type: 'const', value: 'auto', meta: { description: '自動' } },
    7: { type: 'const', value: false },
    8: { type: 'const', value: null },
    9: { type: 'object', dict: { interval: 10, command: 11 } },
    10: { type: 'number' },
    11: { type: 'string' },
    12: { type: 'array', inner: 3 },
    13: { type: 'dict', inner: 3 },
    14: { type: 'future-format' },
    15: { type: 'union', list: [3, 4] },
  },
}

test('Cordis の参照表から全種類の入力部品と入れ子の項目を作る', () => {
  const row = namespace({
    schema: editorSchema,
    value: { enabled: false, name: '作業用', count: 3, mode: 'auto', retry: { interval: 5, command: '実行' }, list: ['一', '二'], map: { a: '値' }, future: '保持する値', mixed: 2 },
    user: { enabled: false, retry: { interval: 5 } },
  })
  const before = structuredClone(row)
  const fields = schemaFields(row)
  assert.deepEqual(fields.map(field => [field.path, field.kind]), [
    [['enabled'], 'switch'], [['name'], 'text'], [['count'], 'number'], [['mode'], 'select'],
    [['retry'], 'group'], [['list'], 'readonly'], [['map'], 'readonly'], [['future'], 'readonly'], [['mixed'], 'readonly'],
  ])
  assert.equal(fields[0]!.label, '実行する')
  assert.equal(fields[0]!.description, '自動で実行します。')
  assert.equal(fields[0]!.value, false)
  assert.equal(fields[0]!.overridden, true)
  assert.equal(fields[1]!.required, true)
  assert.equal(fields[1]!.overridden, false)
  assert.deepEqual([fields[2]!.min, fields[2]!.max, fields[2]!.step], [1, 9, 2])
  assert.deepEqual(fields[3]!.options, [
    { label: '自動', value: 'auto' }, { label: '無効', value: false }, { label: '指定しない', value: null },
  ])
  assert.equal(Object.hasOwn(fields[4]!, 'value'), false)
  assert.deepEqual(fields[4]!.children!.map(field => [field.path, field.kind, field.value, field.overridden]), [
    [['retry', 'interval'], 'number', 5, true], [['retry', 'command'], 'text', '実行', false],
  ])
  assert.deepEqual(fields[5]!.value, ['一', '二'])
  assert.deepEqual(fields[6]!.value, { a: '値' })
  assert.equal(fields[7]!.value, '保持する値')
  assert.deepEqual(row, before)
})

test('intersect の複数の object を同じ階層へ展開し、入れ子にも対応する', () => {
  const fields = schemaFields(namespace({
    schema: { uid: 'root', refs: {
      root: { type: 'intersect', list: ['first', 'second'] },
      first: { type: 'object', dict: { enabled: 'flag' } },
      second: { type: 'object', dict: { retry: 'nested' } },
      nested: { type: 'intersect', list: ['innerA', 'innerB'] },
      innerA: { type: 'object', dict: { count: 'number' } },
      innerB: { type: 'object', dict: { name: 'text' } },
      flag: { type: 'boolean' }, number: { type: 'number' }, text: { type: 'string' },
    } },
    value: { enabled: true, retry: { count: 4, name: '再試行' } },
  }))
  assert.deepEqual(fields.map(field => [field.path, field.kind]), [[['enabled'], 'switch'], [['retry'], 'group']])
  assert.deepEqual(fields[1]!.children!.map(field => [field.path, field.kind, field.value]), [
    [['retry', 'count'], 'number', 4], [['retry', 'name'], 'text', '再試行'],
  ])
})

test('循環参照と欠落した参照を停止し、同じ型を使う正常な項目を残す', () => {
  const input = { uid: 'root', refs: {
    root: { type: 'object', dict: { first: 'text', second: 'text', loop: 'root', missing: 'absent' } },
    text: { type: 'string' },
  } }
  const before = structuredClone(input)
  const decoded = decodeSchema(input)
  assert.equal(decoded.dict!.first!.type, 'string')
  assert.equal(decoded.dict!.second!.type, 'string')
  assert.deepEqual(decoded.dict!.loop, {})
  assert.deepEqual(decoded.dict!.missing, {})
  assert.deepEqual(input, before)
  assert.deepEqual(schemaFields(namespace({ schema: input, value: { first: '一', second: '二', loop: '循環', missing: '欠落' } }))
    .map(field => field.kind), ['text', 'text', 'readonly', 'readonly'])
})

test('不正な参照表や未知の型は読み取り専用へ縮退する', () => {
  for (const input of [null, undefined, 1, [], {}, { type: 'string' }, { uid: 2, refs: { 1: { type: 'string' } } }]) {
    assert.deepEqual(decodeSchema(input), {})
  }
  const field = schemaFields(namespace({ schema: { uid: 1, refs: { 1: { type: 'new-kind' } } }, value: { preserved: true } }))[0]!
  assert.equal(field.kind, 'readonly')
  assert.deepEqual(field.value, { preserved: true })
})

test('定数の組み合わせのみ選択欄にし、数値や真偽の値を文字へ変換しない', () => {
  const fields = schemaFields(namespace({
    schema: { uid: 1, refs: {
      1: { type: 'object', dict: { count: 2, unsupported: 7, empty: 8 } },
      2: { type: 'union', list: [3, 4, 5, 6] },
      3: { type: 'const', value: 0 }, 4: { type: 'const', value: true },
      5: { type: 'const', value: '手動' }, 6: { type: 'const', value: null },
      7: { type: 'union', list: [9] }, 8: { type: 'union', list: [] },
      9: { type: 'const', value: { nested: true } },
    } },
    value: { count: 0, unsupported: { nested: true }, empty: '' },
  }))
  assert.deepEqual(fields[0]!.options!.map(option => option.value), [0, true, '手動', null])
  assert.deepEqual(fields.map(field => field.kind), ['select', 'readonly', 'readonly'])
})

test('上位の無効状態を子へ伝え、説明文が英語だけなら日本語の案内を使う', () => {
  const fields = schemaFields(namespace({
    schema: { uid: 1, refs: {
      1: { type: 'object', meta: { disabled: true }, dict: { retry: 2 } },
      2: { type: 'object', dict: { count: 3 } },
      3: { type: 'number', meta: { description: 'Maximum count', title: 'Count' } },
    } }, value: { retry: { count: 3 } },
  }))
  assert.equal(fields[0]!.disabled, true)
  const child = fields[0]!.children![0]!
  assert.equal(child.disabled, true)
  assert.equal(child.label, '回数')
  assert.equal(child.description, '説明は標準の画面で確認できます。')
})

test('未設定の選択欄と候補外の値を区別し、false・0・空文字・null の候補は選択済みにする', () => {
  const [field] = schemaFields(namespace({ schema: { uid: 1, refs: {
    1: { type: 'object', dict: { mode: 2 } }, 2: { type: 'union', list: [3, 4, 5, 6] },
    3: { type: 'const', value: false }, 4: { type: 'const', value: 0 },
    5: { type: 'const', value: '' }, 6: { type: 'const', value: null },
  } } }))
  assert.ok(field)
  assert.equal(field.kind, 'select')
  assert.deepEqual(selectFieldState(field, field.value), { index: -1, placeholder: '未設定' })
  assert.deepEqual(selectFieldState(field, '未対応の値'), { index: -1, placeholder: '現在の値は選択肢にありません' })
  for (const [index, value] of [false, 0, '', null].entries()) {
    assert.deepEqual(selectFieldState(field, value), { index, placeholder: undefined })
  }
  assert.deepEqual(selectFieldState({ options: [] }, null), { index: -1, placeholder: '現在の値は選択肢にありません' })
})

test('伏せる項目の保存済み値は項目モデルにもページの要約にも渡さない', () => {
  const row = namespace({
    schema: { uid: 1, refs: {
      1: { type: 'object', dict: { accessKey: 2, nested: 3 } },
      2: { type: 'string', meta: { role: 'password', title: '接続キー' } },
      3: { type: 'object', dict: { token: 2 } },
    } },
    value: { accessKey: 'stored-key-do-not-display', nested: { token: 'nested-key-do-not-display' } },
    base: { accessKey: 'base-key-do-not-display' },
    user: { accessKey: 'user-key-do-not-display', nested: { token: 'user-nested-key-do-not-display' } },
  })
  const fields = schemaFields(row)
  for (const field of [fields[0]!, fields[1]!.children![0]!]) {
    assert.equal(field.kind, 'masked')
    assert.equal(Object.hasOwn(field, 'value'), false)
    assert.equal(field.overridden, true)
    assert.equal(field.registered, true)
  }
  assert.equal(Object.hasOwn(fields[1]!, 'value'), false)
  assert.doesNotMatch(JSON.stringify(fields), /do-not-display/)
  assert.doesNotMatch(pageSummary('other', [row]), /do-not-display/)
  assert.equal(pageSummary('other', [row]), '設定項目を確認')
})

test('通常の未設定項目は型どおり編集でき、false・0・空文字も保持する', () => {
  const fields = schemaFields(namespace({
    schema: { uid: 1, refs: {
      1: { type: 'object', dict: { reasoningEffort: 2, enabled: 3, count: 4, name: 2, accessKey: 5, optionalFlag: 3, optionalCount: 4 } },
      2: { type: 'string' }, 3: { type: 'boolean' }, 4: { type: 'number' },
      5: { type: 'string', meta: { role: 'password' } },
    } },
    value: { enabled: false, count: 0, name: '' },
  }))
  assert.deepEqual(fields.map(field => field.kind), ['text', 'switch', 'number', 'text', 'masked', 'switch', 'number'])
  assert.equal(fields[0]!.value, undefined)
  assert.equal(fields[0]!.overridden, false)
  assert.equal(fields[0]!.label, '推論の強さ')
  assert.deepEqual(parseFieldInput(fields[0]!, 'high'), { ok: true, value: 'high' })
  assert.deepEqual(buildPatch(fields[0]!.path, 'high'), { reasoningEffort: 'high' })
  assert.deepEqual(fields.slice(1, 4).map(field => field.value), [false, 0, ''])
  assert.equal(Object.hasOwn(fields[4]!, 'value'), false)
  assert.equal(fields[4]!.registered, false)
  assert.deepEqual(parseFieldInput(fields[6]!, '2'), { ok: true, value: 2 })
})

test('状態メタ情報が伏せる項目を決め、保存値がなくても登録状態を表示できる', () => {
  const row = namespace({
    schema: { uid: 1, refs: {
      1: { type: 'object', dict: { saved: 2, empty: 2, profile: 3, reasoningEffort: 2 } },
      2: { type: 'string' },
      3: { type: 'object', dict: { token: 2 } },
    } },
    value: { empty: 'unexpected-do-not-display', profile: { token: 'nested-do-not-display' } },
    base: { saved: 'base-do-not-display' }, user: { saved: 'user-do-not-display' },
    secrets: [{ path: ['saved'], set: true }, { path: ['empty'], set: false }, { path: ['profile'], set: true }],
  })
  const before = structuredClone(row)
  const fields = schemaFields(row)
  assert.deepEqual(fields.map(field => [field.kind, field.registered]), [
    ['masked', true], ['masked', false], ['masked', true], ['text', undefined],
  ])
  assert.equal(fields[2]!.children, undefined)
  assert.ok(fields.slice(0, 3).every(field => !Object.hasOwn(field, 'value')))
  assert.doesNotMatch(JSON.stringify(fields), /do-not-display/)
  assert.doesNotMatch(pageSummary('other', [row]), /do-not-display/)
  assert.deepEqual(row, before)
})

test('読み取り専用の辞書と配列からも保護パスと伏せ字指定の値を除去する', () => {
  const row = namespace({
    schema: { uid: 1, refs: {
      1: { type: 'object', dict: { map: 2, list: 3, passwords: 4 } },
      2: { type: 'dict', inner: 5 },
      3: { type: 'array', inner: 5 },
      4: { type: 'array', inner: 6 },
      5: { type: 'object', dict: { token: 6, name: 7 } },
      6: { type: 'string', meta: { role: 'password' } },
      7: { type: 'string' },
    } },
    value: {
      map: { first: { token: 'map-do-not-display', name: '辞書の項目' }, hidden: 'metadata-do-not-display' },
      list: [{ token: 'array-do-not-display', name: '配列の項目' }, 'metadata-array-do-not-display'],
      passwords: ['role-array-do-not-display'],
    },
    secrets: [{ path: ['map', 'hidden'], set: true }, { path: ['list', '1'], set: true }],
  })
  const before = structuredClone(row)
  const fields = schemaFields(row)
  assert.ok(fields.every(field => field.kind === 'readonly'))
  assert.deepEqual(fields.map(field => field.value), [
    { first: { name: '辞書の項目' } }, [{ name: '配列の項目' }, null], [null],
  ])
  for (const field of fields) assert.doesNotMatch(formatSetting(valueAt(field.value, [])), /do-not-display/)
  assert.doesNotMatch(JSON.stringify(fields), /do-not-display/)
  assert.doesNotMatch(pageSummary('other', [row]), /do-not-display/)
  assert.deepEqual(row, before)
})

test('未知のルート型にも保護パスを適用して読み取り専用の表示値を作る', () => {
  const row = namespace({
    schema: { uid: 1, refs: { 1: { type: 'future-format' } } },
    value: { token: 'root-do-not-display', name: '残す値' },
    secrets: [{ path: ['token'], set: true }],
  })
  const fields = schemaFields(row)
  assert.equal(fields[0]!.kind, 'readonly')
  assert.deepEqual(fields[0]!.value, { name: '残す値' })
  assert.doesNotMatch(formatSetting(fields[0]!.value), /do-not-display/)
})

test('上書き層が省略された応答を扱い、まとまり全体が伏せられた場合は子を描かない', () => {
  const row = namespace({ schema: editorSchema, value: { name: '既定の名前' }, base: undefined, user: undefined })
  const name = schemaFields(row).find(field => field.path[0] === 'name')!
  assert.equal(name.kind, 'text')
  assert.equal(name.overridden, false)
  const protectedRoot = namespace({
    schema: { uid: 1, refs: {
      1: { type: 'object', dict: { name: 2 }, meta: { role: 'password' } },
      2: { type: 'string' },
    } }, value: { name: 'whole-value-not-for-display' },
  })
  const fields = schemaFields(protectedRoot)
  assert.equal(fields.length, 1)
  assert.equal(fields[0]!.kind, 'masked')
  assert.equal(fields[0]!.children, undefined)
  assert.doesNotMatch(JSON.stringify(fields), /whole-value-not-for-display/)
})

test('名前空間を 5 ページとその他に分け、従来の画面用設定を除外する', () => {
  const ids = [
    'agent-default-model', 'subagent-model-selection', 'permission', 'agent-presets', 'agent-loop',
    'llm-deepseek', 'llm-pi-ai', 'llm-retry', 'llm-future', 'web-search-deepseek', 'shell', 'locale',
    'new-plugin', 'llm', 'ui', 'ui-theme', 'ui-onboarding', 'ui-future',
  ]
  const rows = ids.map(ns => namespace({ ns }))
  const groups = groupNamespaces(rows)
  assert.deepEqual(Object.fromEntries(Object.entries(groups).map(([page, values]) => [page, values.map(row => row.ns)])), {
    models: ['agent-default-model', 'subagent-model-selection'], permission: ['permission'],
    agent: ['agent-presets', 'agent-loop'], providers: ['llm-deepseek', 'llm-pi-ai', 'llm-retry', 'llm-future'],
    tools: ['web-search-deepseek', 'shell', 'locale'], other: ['new-plugin', 'llm', 'ui'],
  })
  assert.equal(groups.models[0], rows[0])
  assert.deepEqual(rows.map(row => row.ns), ids)
  assert.deepEqual(groupNamespaces([]), { models: [], permission: [], agent: [], providers: [], tools: [], other: [] })
})

test('保存差分は指定した葉だけを含み、既定値への復帰は unset 操作を作る', () => {
  const path = ['retry', 'count']
  assert.deepEqual(buildPatch(path, 0), { retry: { count: 0 } })
  assert.deepEqual(buildPatch(['enabled'], false), { enabled: false })
  assert.deepEqual(buildPatch(['name'], ''), { name: '' })
  assert.deepEqual(buildPatch(['mode'], null), { mode: null })
  assert.deepEqual(buildPatch(['model.with.dots'], '作業用'), { 'model.with.dots': '作業用' })
  const reset = buildReset(path)
  assert.deepEqual(reset, [{ op: 'unset', path: ['retry', 'count'] }])
  assert.notEqual(reset[0]!.path, path)
  reset[0]!.path.push('local-change')
  assert.deepEqual(path, ['retry', 'count'])
})

test('不正な保存先を拒否し、値の参照は自身のプロパティだけを見る', () => {
  for (const path of [[], [''], ['retry', ''], ['__proto__'], ['constructor'], ['retry', 'prototype']]) {
    assert.throws(() => buildPatch(path, '値'), /設定項目の場所が不正/)
    assert.throws(() => buildReset(path), /設定項目の場所が不正/)
  }
  const inherited = Object.create({ inherited: '外側の値' }) as Record<string, unknown>
  inherited.own = { enabled: false, count: 0, name: '', mode: null }
  assert.equal(valueAt(inherited, ['inherited']), undefined)
  assert.equal(valueAt(inherited, ['__proto__']), undefined)
  assert.equal(valueAt(inherited, ['own', 'missing']), undefined)
  assert.equal(valueAt(inherited, ['own', 'enabled']), false)
  assert.equal(valueAt(inherited, ['own', 'count']), 0)
  assert.equal(valueAt(inherited, ['own', 'name']), '')
  assert.equal(valueAt(inherited, ['own', 'mode']), null)
})

function numericField(overrides: Partial<SettingField> = {}): SettingField {
  return { path: ['count'], kind: 'number', label: '回数', description: '', overridden: false, disabled: false, required: false, ...overrides }
}

test('数値入力の上下限と刻みを検査し、範囲の端も保存できる', () => {
  const field = numericField({ min: 1, max: 5, step: 2 })
  assert.deepEqual(parseFieldInput(field, '1'), { ok: true, value: 1 })
  assert.deepEqual(parseFieldInput(field, ' 3 '), { ok: true, value: 3 })
  assert.deepEqual(parseFieldInput(field, '5'), { ok: true, value: 5 })
  assert.deepEqual(parseFieldInput(field, '0'), { ok: false, message: '1 以上にしてください。' })
  assert.deepEqual(parseFieldInput(field, '6'), { ok: false, message: '5 以下にしてください。' })
  assert.deepEqual(parseFieldInput(field, '2'), { ok: false, message: '2 刻みで入力してください。' })
  assert.deepEqual(parseFieldInput(numericField({ min: 0.1, step: 0.1 }), '0.3'), { ok: true, value: 0.3 })
  assert.equal(parseFieldInput(numericField({ step: 0.5 }), '0.25').ok, false)
})

test('空欄や有限でない数値を保存せず、必須の文字入力を検査する', () => {
  for (const input of ['', ' ', 'abc', 'NaN', 'Infinity', '-Infinity', '1e999']) {
    const result = parseFieldInput(numericField(), input)
    assert.equal(result.ok, false, `不正な数値: ${JSON.stringify(input)}`)
    assert.equal(Object.hasOwn(result, 'value'), false)
  }
  const required = numericField({ kind: 'text', required: true })
  assert.deepEqual(parseFieldInput(required, '  '), { ok: false, message: '値を入力してください。' })
  assert.deepEqual(parseFieldInput(required, ' 作業用 '), { ok: true, value: ' 作業用 ' })
})

test('任意の文字入力を空にすると unset 用の値になり、空白だけの入力も既定値に戻す', () => {
  const field = numericField({ kind: 'text', path: ['reasoningEffort'] })
  for (const input of ['', ' ', '\t\n', '　']) {
    assert.deepEqual(parseFieldInput(field, input), { ok: true, value: undefined })
  }
  assert.deepEqual(parseFieldInput(field, 'high'), { ok: true, value: 'high' })
  assert.deepEqual(parseFieldInput(field, ' 作業用 '), { ok: true, value: ' 作業用 ' })
})
