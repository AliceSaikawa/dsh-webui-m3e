import assert from 'node:assert/strict'
import { test } from 'node:test'
import { InteractionStore } from '../web/src/dsh/interactions-store.ts'
import { approvalReason } from '../web/src/features/interactions/approval-reason.ts'

const sandboxReason = 'escalate sandbox to danger-full-access: pnpm test'
const displayReason = {
  en: 'Allow this operation with danger-full-access permissions: pnpm test',
  zh: '允许本次操作使用 danger-full-access 权限：pnpm test',
}

test('displayReason があれば画面の言語の訳を使い、無ければ英語を使う', () => {
  assert.equal(approvalReason({ reason: sandboxReason, displayReason }, 'zh'), displayReason.zh)
  assert.equal(approvalReason({ reason: sandboxReason, displayReason }, 'en'), displayReason.en)
  // 日本語の訳はまだ無いので、内部向けの reason ではなく英語の訳を出す。
  assert.equal(approvalReason({ reason: sandboxReason, displayReason }, 'ja'), displayReason.en)
})

test('displayReason が無ければ今までどおり reason を出し、どちらも無ければ出さない', () => {
  assert.equal(approvalReason({ reason: '確認が必要です' }, 'ja'), '確認が必要です')
  assert.equal(approvalReason({ reason: sandboxReason }, 'en'), sandboxReason)
  assert.equal(approvalReason({}, 'ja'), undefined)
})

test('承認の待ち行列は displayReason を捨てずに残す', async () => {
  const store = new InteractionStore()
  const result = store.requestApproval('session-a', { toolName: 'bash', callId: 'call-1', reason: sandboxReason, displayReason })
  const pending = store.getSnapshot()[0]
  if (pending?.kind !== 'approval') assert.fail('承認がありません')
  assert.deepEqual(pending.displayReason, displayReason)
  assert.equal(approvalReason(pending, 'ja'), displayReason.en)
  await pending.answer('allowed-once')
  assert.equal(await result, 'allowed-once')
})
