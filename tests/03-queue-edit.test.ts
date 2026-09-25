import assert from 'node:assert/strict'
import test from 'node:test'
import { remoteErrorMessage, RemoteCallError } from '../web/src/dsh/remote-result.ts'
import type { QueueAction, SessionFace } from '../web/src/dsh/services.ts'
import { queueEditPrompt } from '../web/src/features/composer/queue-edit.ts'

const item = { id: 'queued-one', text: '  最初の行\n\n    字下げ\n', content: [] }

test('順番待ち編集は共通の複数行入力を使い、保存の応答まで閉じずに本文を保持する', async () => {
  const calls: { id: string; action: QueueAction }[] = []
  type UpdateResult = Awaited<ReturnType<SessionFace['updateQueue']>>
  let resolveResponse!: (result: UpdateResult) => void
  const response = new Promise<UpdateResult>(resolve => { resolveResponse = resolve })
  let closed = 0
  const prompt = queueEditPrompt({
    updateQueue(id, action) { calls.push({ id, action }); return response },
  }, item, () => { closed++ })
  assert.equal(prompt.multiline, true)
  assert.equal(prompt.rows, 3)
  assert.equal(prompt.initialValue, item.text)
  const edited = '  編集した行\n\n    改行と字下げを残す\n'
  const saved = prompt.onConfirm(edited)
  assert.equal(closed, 0)
  assert.deepEqual(calls, [{ id: item.id, action: { kind: 'edit', content: [{ type: 'text', text: edited }] } }])
  resolveResponse({ ok: true, value: { accepted: true } })
  await saved
  assert.equal(closed, 1)
  assert.equal(item.text, '  最初の行\n\n    字下げ\n')
})

test('保存失敗は共通ダイアログへ伝わり、閉じずに同じメッセージを再試行できる', async () => {
  const failure = { code: 'session/queue-item-not-found', message: 'Already consumed', details: { itemId: item.id } }
  let attempts = 0
  let closed = 0
  const prompt = queueEditPrompt({
    async updateQueue(id) {
      assert.equal(id, item.id)
      return ++attempts === 1 ? { ok: false, error: failure } : { ok: true, value: { accepted: true } }
    },
  }, item, () => { closed++ })
  await assert.rejects(async () => prompt.onConfirm('編集中の本文'), cause => {
    assert.ok(cause instanceof RemoteCallError)
    assert.equal(cause.rpcError, failure)
    assert.equal(remoteErrorMessage(cause), 'このメッセージはすでに順番待ちから外れています。')
    return true
  })
  assert.equal(closed, 0)
  await prompt.onConfirm('もう一度編集した本文')
  assert.equal(attempts, 2)
  assert.equal(closed, 1)
})

test('通信の例外も握りつぶさずにダイアログへ返す', async () => {
  const failure = new Error('Connection interrupted')
  let closed = 0
  const prompt = queueEditPrompt({ async updateQueue() { throw failure } }, item, () => { closed++ })
  await assert.rejects(async () => prompt.onConfirm(item.text), cause => cause === failure)
  assert.equal(closed, 0)
})

test('画像だけのメッセージにも添付が外れる注意を示し、キャンセルは保存しない', () => {
  let closed = 0
  const prompt = queueEditPrompt({ async updateQueue() { assert.fail('キャンセルでは更新しない') } }, {
    id: item.id,
    text: null,
    content: [{ type: 'image', attachment: { attachmentId: 'image-one', mediaType: 'image/png', bytes: 10, width: 1, height: 1 } }],
  }, () => { closed++ })
  assert.equal(prompt.initialValue, '')
  assert.match(prompt.label!, /編集すると添付画像は外れます/u)
  prompt.onCancel()
  assert.equal(closed, 1)
})
