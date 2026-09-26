import assert from 'node:assert/strict'
import test from 'node:test'
import { selectSearchModelIcon } from '../web/src/features/search/search-model-icon.ts'

test('search recognizes DeepSeek by the same provider and model names as the session list', () => {
  for (const lastUsed of [
    { provider: 'deepseek', model: 'chat' },
    { provider: ' DEEPSEEK-api ', model: 'reasoner' },
    { provider: 'other', model: 'DeepSeek-V4' },
    { provider: 'other', model: 'deepseek-ai/DeepSeek-V3' },
    { provider: 'other', model: ' deepseek/DeepSeek-R1 ' },
  ]) {
    assert.deepEqual(selectSearchModelIcon({ modelSelection: { lastUsed } }), { kind: 'deepseek' })
  }
})

test('unknown models use their Unicode initial and similar names do not imply DeepSeek', () => {
  for (const [lastUsed, initial] of [
    [{ provider: 'other', model: ' gpt-test ' }, 'G'],
    [{ provider: 'other', model: '日本語モデル' }, '日'],
    [{ model: '🚀モデル' }, '🚀'],
    [{ provider: 'notdeepseek', model: 'notdeepseek-chat' }, 'N'],
    [{ provider: 42, model: 'model' }, 'M'],
  ] as const) {
    assert.deepEqual(selectSearchModelIcon({ modelSelection: { lastUsed } }), { kind: 'initial', initial })
  }
})

test('missing or malformed model projections use the generic icon without throwing', () => {
  for (const projectionValues of [
    undefined, null, false, 42, 'modelSelection', [], {},
    { modelSelection: undefined }, { modelSelection: null }, { modelSelection: true },
    { modelSelection: 42 }, { modelSelection: 'deepseek' }, { modelSelection: [] },
    { modelSelection: {} }, { modelSelection: { lastUsed: null } },
    { modelSelection: { lastUsed: 'deepseek' } }, { modelSelection: { lastUsed: [] } },
    { modelSelection: { lastUsed: { provider: 'deepseek', model: ' ' } } },
    { modelSelection: { lastUsed: { provider: 'deepseek', model: 123 } } },
  ]) {
    assert.deepEqual(selectSearchModelIcon(projectionValues), { kind: 'generic' })
  }
})

test('the last model that ran wins over a different pending or next selection', () => {
  const projectionValues = {
    modelSelection: {
      lastUsed: { provider: 'other', model: 'gpt-test' },
      pending: { provider: 'deepseek', model: 'reasoner' },
      next: { provider: 'deepseek', model: 'reasoner' },
    },
  }
  const before = structuredClone(projectionValues)
  assert.deepEqual(selectSearchModelIcon(projectionValues), { kind: 'initial', initial: 'G' })
  assert.deepEqual(projectionValues, before)
  assert.deepEqual(selectSearchModelIcon({ modelSelection: { next: projectionValues.modelSelection.next } }), { kind: 'generic' })
})
