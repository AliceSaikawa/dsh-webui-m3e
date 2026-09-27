import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModelCatalog } from '../web/src/features/composer/api.ts'
import { createModelApplyController, effortValue, modelChoices, modelValue, reasoningForSelection, selectionFromModelValue } from '../web/src/features/composer/model-picker.ts'

const catalog: ModelCatalog = {
  default: { provider: 'first', model: 'shared', reasoningEffort: 'high' },
  routableProviders: ['first', 'second'],
  failures: [],
  groups: [
    { id: 'first', name: '提供元一', models: [{ id: 'shared', name: '共通', reasoning: {
      efforts: [{ id: 'low', name: '低' }, { id: 'high', name: '高' }], defaultEffort: 'high',
    } }] },
    { id: 'second', name: '提供元二', models: [{ id: 'shared', name: '共通' }] },
  ],
}

test('ドロップダウンの値は提供元とモデルを区別し、選択へ戻せる', () => {
  const choices = modelChoices(catalog)
  assert.deepEqual(choices.map(choice => choice.label), ['提供元一 / 共通', '提供元二 / 共通'])
  assert.notEqual(choices[0]?.value, choices[1]?.value)
  for (const choice of choices) {
    assert.deepEqual(selectionFromModelValue(choice.value, choices), { provider: choice.provider, model: choice.model.id })
    assert.equal(modelValue({ provider: choice.provider, model: choice.model.id }), choice.value)
  }
  assert.equal(selectionFromModelValue('invalid', choices), undefined)
  assert.equal(modelValue(null), '')
})

test('考える深さは対応モデルだけにあり、選択値かモデルの既定値を使う', () => {
  const choices = modelChoices(catalog)
  assert.equal(effortValue(catalog.default, choices), 'high')
  assert.equal(effortValue({ provider: 'first', model: 'shared', reasoningEffort: 'low' }, choices), 'low')
  assert.equal(effortValue({ provider: 'first', model: 'shared' }, choices), 'high')
  assert.equal(reasoningForSelection({ provider: 'second', model: 'shared' }, choices), undefined)
  assert.equal(reasoningForSelection(null, choices), undefined)
  const unknownDefault: ModelCatalog = { ...catalog, groups: [{ id: 'first', name: '提供元一', models: [{
    id: 'shared', name: '共通', reasoning: { efforts: [{ id: 'low', name: '低' }] },
  }] }] }
  assert.equal(effortValue({ provider: 'first', model: 'shared' }, modelChoices(unknownDefault)), '')
})

test('反映要求はシートを開き直しても一つだけ進み、成功と失敗を共有する', async () => {
  const controller = createModelApplyController()
  const firstSelection = { provider: 'first', model: 'shared' }
  let finish!: (value: typeof firstSelection) => void
  const first = controller.run(firstSelection, () => new Promise(resolve => { finish = resolve }))
  assert.equal(controller.getSnapshot().pending, true)
  await assert.rejects(controller.run({ provider: 'second', model: 'shared' }, async value => value), /反映中/u)
  finish(firstSelection)
  assert.deepEqual(await first, firstSelection)
  assert.deepEqual(controller.getSnapshot().selected, firstSelection)
  assert.equal(controller.getSnapshot().pending, false)
  const failure = new Error('反映できませんでした。')
  await assert.rejects(controller.run(firstSelection, async () => { throw failure }), error => error === failure)
  assert.equal(controller.getSnapshot().error, failure)
  assert.deepEqual(controller.getSnapshot().selected, firstSelection)
})
