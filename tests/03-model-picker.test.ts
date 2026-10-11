import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModelCatalog } from '../web/src/features/composer/api.ts'
import { createModelApplyController, modelApplyController, effortValue, modelChoices, modelValue, reasoningForSelection, selectionFromModelValue } from '../web/src/features/composer/model-picker.ts'
import { consumeDraftCommand, draftTextRevision, readDraft, writeDraft } from '../web/src/features/composer/drafts.ts'

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

test('送信中はモデル変更を開始せず、送信終了後に選べる', async () => {
  const controller = createModelApplyController()
  const selection = { provider: 'first', model: 'shared' }
  let calls = 0
  const apply = async () => { calls++; return selection }
  controller.setComposerBusy(true)
  await assert.rejects(controller.run(selection, apply), /送信/u)
  assert.equal(calls, 0)
  controller.setComposerBusy(false)
  await controller.run(selection, apply)
  assert.equal(calls, 1)
})

test('反映中の controller は同じサービスと下書きだけで再利用する', async () => {
  const scope = {}, otherScope = {}
  const first = modelApplyController(scope, 'session:shared')
  let finish!: () => void
  const selection = { provider: 'first', model: 'shared' }
  const pending = first.run(selection, async () => { await new Promise<void>(resolve => { finish = resolve }); return selection })
  assert.equal(modelApplyController(scope, 'session:shared'), first)
  assert.equal(modelApplyController(scope, 'session:shared').getSnapshot().pending, true)
  assert.equal(modelApplyController(scope, 'session:other').getSnapshot().pending, false)
  assert.equal(modelApplyController(otherScope, 'session:shared').getSnapshot().pending, false)
  finish(); await pending
  assert.equal(modelApplyController(scope, 'session:shared').getSnapshot().pending, false)
})

test('コマンド消費は本文編集の世代を確認し、画像やエラーの更新では無効化しない', () => {
  const key = 'session:model-command-revisions'
  writeDraft(key, { text: ' /model ', images: [] })
  const original = draftTextRevision(key)
  writeDraft(key, { ...readDraft(key), preparingImages: 1, error: '画像準備中' })
  consumeDraftCommand(key, '/model', original)
  assert.equal(readDraft(key).text, '')
  assert.equal(readDraft(key).preparingImages, 1)
  writeDraft(key, { ...readDraft(key), text: '/model' })
  const edited = draftTextRevision(key)
  writeDraft(key, { ...readDraft(key), text: '新しい本文' })
  writeDraft(key, { ...readDraft(key), text: '/model' })
  consumeDraftCommand(key, '/model', edited)
  assert.equal(readDraft(key).text, '/model')
})
