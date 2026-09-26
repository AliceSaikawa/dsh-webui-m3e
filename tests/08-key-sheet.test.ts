import assert from 'node:assert/strict'
import test from 'node:test'
import { createKeyDraft, type KeyOutcome } from '../web/src/features/settings/providers.ts'

test('削除確認で入力シートを破棄し戻ったときは未送信の入力も表示状態も復元しない', async () => {
  let saves = 0
  const save = async (): Promise<KeyOutcome> => { saves++; return { ok: true } }
  const beforeConfirmation = createKeyDraft(save)
  beforeConfirmation.input('value-before-confirmation')
  beforeConfirmation.toggle()
  beforeConfirmation.dispose()

  const afterCancellation = createKeyDraft(save)
  assert.deepEqual(beforeConfirmation.getSnapshot(), { draft: '', visible: false, busy: false, error: null })
  assert.deepEqual(afterCancellation.getSnapshot(), { draft: '', visible: false, busy: false, error: null })
  assert.equal(await beforeConfirmation.submit(), false)
  assert.equal(await afterCancellation.submit(), false)
  assert.equal(saves, 0)

  afterCancellation.input('new-input-after-cancellation')
  assert.equal(await afterCancellation.submit(), true)
  assert.equal(saves, 1)
  assert.deepEqual(afterCancellation.getSnapshot(), { draft: '', visible: false, busy: false, error: null })
  afterCancellation.dispose()
})
