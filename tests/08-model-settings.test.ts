import assert from 'node:assert/strict'
import test from 'node:test'
import { mockModelCatalog } from '../web/src/features/composer/mock.ts'
import { modelChoices } from '../web/src/features/composer/model-picker.ts'
import {
  chooseModel, modelSaveOperations, modelSelectionState, savedModel, selectedEffort,
  subagentSelection, toggleAllowedModel,
} from '../web/src/features/settings/model-settings.ts'

const choices = modelChoices(mockModelCatalog)
const deepseek = choices.find(item => item.model.id === 'deepseek-v4')!
const local = choices.find(item => item.model.id === 'local')!

test('モデルの選択は提供元・モデル・既定の推論を一緒に保存し、非対応モデルでは推論を消す', () => {
  assert.deepEqual(chooseModel(deepseek), { provider: 'deepseek', model: 'deepseek-v4', reasoningEffort: 'high' })
  assert.deepEqual(chooseModel(local), { provider: 'ollama', model: 'local' })
  assert.deepEqual(modelSaveOperations(chooseModel(local)), [
    { op: 'set', path: ['provider'], value: 'ollama' },
    { op: 'set', path: ['model'], value: 'local' },
    { op: 'unset', path: ['reasoningEffort'] },
  ])
  assert.deepEqual(modelSaveOperations(chooseModel(deepseek)).at(-1),
    { op: 'set', path: ['reasoningEffort'], value: 'high' })
})

test('保存済みの一覧外モデルを残し、推論の値がない・候補外なら既定を示す', () => {
  const unknown = { provider: 'outside', model: 'archived', reasoningEffort: 'strong' }
  assert.deepEqual(savedModel(unknown), unknown)
  assert.deepEqual(modelSelectionState(unknown, choices), {
    value: '7:outsidearchived', unknownLabel: '一覧にないモデル：outside / archived',
  })
  assert.equal(selectedEffort({ provider: 'deepseek', model: 'deepseek-v4' }, deepseek), '')
  assert.equal(selectedEffort({ provider: 'deepseek', model: 'deepseek-v4', reasoningEffort: 'unknown' }, deepseek), '')
  assert.equal(selectedEffort(chooseModel(deepseek), deepseek), 'high')
})

test('許可リストは一覧にない値を保持し、追加・削除で他の選択を変えない', () => {
  const outside = { provider: 'outside', model: 'archived' }
  const deepseekRoute = { provider: deepseek.provider, model: deepseek.model.id }
  const initial = subagentSelection({ enabled: true, allowedModels: [outside] })
  assert.deepEqual(initial, { enabled: true, allowedModels: [outside] })
  const added = toggleAllowedModel(initial.allowedModels, deepseekRoute, true)
  assert.deepEqual(added, [outside, deepseekRoute])
  assert.deepEqual(toggleAllowedModel(added, deepseekRoute, true), added)
  assert.deepEqual(toggleAllowedModel(added, outside, false), [deepseekRoute])
  assert.deepEqual(initial.allowedModels, [outside])
})
