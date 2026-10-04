import assert from 'node:assert/strict'
import test from 'node:test'
import { settingsFixtures } from '../web/src/features/settings/mock-fixtures.ts'
import { applyMockOperations, mockSettingsChanged } from '../web/src/features/settings/mock-mutations.ts'
import { validMockOperations } from '../web/src/features/settings/mock-validation.ts'
import { matchesNumberStep } from '../web/src/features/settings/number-step.ts'

test('B1 小数刻みも十進移動で厳密に判定しminと負のstepを尊重する', () => {
  assert.equal(matchesNumberStep(0.3, 0.1, 0.1), true)
  assert.equal(matchesNumberStep(0.30000000001, 0.1, 0.1), false)
  assert.equal(matchesNumberStep(-0.3, -0.5, -0.1), true)
  assert.equal(matchesNumberStep(2, 1, 2), false)
  assert.equal(matchesNumberStep(3, 1, 2), true)
})

test('M3 配列へのset・append・unsetを順番に適用し範囲外を拒否する', () => {
  const row = settingsFixtures().find(row => row.ns === 'subagent-model-selection-settings')!
  row.value = { enabled: true, allowedModels: [{ provider: 'p', model: 'a' }, { provider: 'p', model: 'b' }] }
  row.user = structuredClone(row.value)
  const ops = [
    { op: 'set' as const, path: ['allowedModels', '0', 'model'], value: 'changed' },
    { op: 'set' as const, path: ['allowedModels', '2'], value: { provider: 'p', model: 'c' } },
    { op: 'unset' as const, path: ['allowedModels', '1'] },
  ]
  assert.equal(validMockOperations(row, ops), true)
  assert.deepEqual(applyMockOperations(row, ops), { enabled: true, allowedModels: [{ provider: 'p', model: 'changed' }, { provider: 'p', model: 'c' }] })
  for (const index of ['999', '2', '01', '-1']) {
    const bad = [{ op: 'unset' as const, path: ['allowedModels', index] }]
    assert.throws(() => applyMockOperations(row, bad))
    assert.equal(validMockOperations(row, bad), false)
  }
  assert.deepEqual(row.user, row.value)
})

test('M11 初期revisionは0で無変更の上書き層を変更扱いにしない', () => {
  const rows = settingsFixtures()
  assert.ok(rows.every(row => row.revision === 0))
  const row = rows.find(row => row.ns === 'bash-sandbox')!
  assert.equal(mockSettingsChanged(row, {}), false)
  row.user = { timeoutMs: 61000 }
  assert.equal(mockSettingsChanged(row, { timeoutMs: 61000 }), false)
  assert.equal(mockSettingsChanged(row, { timeoutMs: 62000 }), true)
})
