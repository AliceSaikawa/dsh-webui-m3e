import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findSettingField, settingFieldAccess } from '../web/src/features/settings/field-access.ts'
import type { SettingsNamespace } from '../web/src/features/settings/schema.ts'

function fixture(): SettingsNamespace {
  return {
    ns: 'example', revision: 1, applies: 'live',
    value: { list: ['変更'], labels: { main: '変更' }, group: { child: '変更' }, unknown: { count: 2 }, text: '変更' },
    user: { list: ['変更'], labels: { main: '変更' }, group: { child: '変更' }, unknown: { count: 2 }, text: '変更' },
    schema: { uid: 0, refs: {
      0: { type: 'object', dict: { list: 1, labels: 2, group: 3, unknown: 4, text: 5 } },
      1: { type: 'array', inner: 5 }, 2: { type: 'dict', inner: 5 },
      3: { type: 'object', dict: { child: 5 } }, 4: { type: 'custom' }, 5: { type: 'string' },
    } },
  }
}

test('配列・辞書・未知型・入れ子は通常編集を許可せず、上書きだけ復帰できる', () => {
  const row = fixture()
  for (const path of [['list'], ['labels'], ['unknown'], ['group']]) {
    const field = findSettingField(row, path)
    assert.ok(field)
    assert.deepEqual(settingFieldAccess(row, field), { edit: false, reset: true, resetBlocked: false })
    assert.deepEqual(settingFieldAccess(row, { ...field, overridden: false }), { edit: false, reset: false, resetBlocked: false })
  }
  const child = findSettingField(row, ['group', 'child'])
  assert.ok(child)
  assert.deepEqual(settingFieldAccess(row, child), { edit: true, reset: true, resetBlocked: false })
  assert.equal(findSettingField(row, ['absent']), undefined)
})

test('保護された子のある複合値と、保護された値そのものを汎用復帰から除く', () => {
  const row = fixture()
  row.secrets = [{ path: ['labels', 'main'], set: true }, { path: ['group', 'child'], set: true }]
  for (const path of [['labels'], ['group']]) {
    const field = findSettingField(row, path)
    assert.ok(field)
    assert.deepEqual(settingFieldAccess(row, field), { edit: false, reset: false, resetBlocked: true })
  }
  const child = findSettingField(row, ['group', 'child'])
  assert.ok(child)
  assert.equal(child.kind, 'masked')
  assert.deepEqual(settingFieldAccess(row, child), { edit: false, reset: false, resetBlocked: false })
})

test('辞書・配列の未設定の保護要素や無効な子も親の一括復帰で消さない', () => {
  for (const meta of [{ role: 'password' }, { disabled: true }]) {
    const row = fixture()
    const schema = row.schema as { refs: Record<number, { meta?: typeof meta }> }
    schema.refs[5]!.meta = meta
    row.value = {}; row.user = { list: [], labels: {}, group: {} }
    for (const path of [['list'], ['labels'], ['group']]) {
      const field = findSettingField(row, path)
      assert.ok(field)
      assert.equal(settingFieldAccess(row, field).reset, false)
      assert.equal(settingFieldAccess(row, field).resetBlocked, true)
    }
  }
})

test('無効な項目と名前空間全体・不正パスは復帰できない', () => {
  const row = fixture()
  const field = findSettingField(row, ['list'])
  assert.ok(field)
  assert.equal(settingFieldAccess(row, { ...field, disabled: true }).reset, false)
  for (const path of [[], [''], ['__proto__']]) {
    assert.deepEqual(settingFieldAccess(row, { ...field, path }), { edit: false, reset: false, resetBlocked: false })
  }
})
