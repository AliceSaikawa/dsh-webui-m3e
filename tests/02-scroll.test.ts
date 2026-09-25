import assert from 'node:assert/strict'
import test from 'node:test'
import { canObserveChatScroll, decideChatScroll, enterChatVisibility, finishChatRestore, initialChatScrollState, shouldDiscardChatAnchor } from '../web/src/features/chat/scroll-policy.ts'

test('非表示の初回履歴・生成更新では初回表示済みにせず、監視と移動を許さない', () => {
  const hidden = enterChatVisibility(initialChatScrollState, false, true)
  assert.equal(hidden.action, 'suspend')
  assert.equal(hidden.state.initialized, false)
  assert.equal(canObserveChatScroll(hidden.state), false)
  assert.equal(decideChatScroll(hidden.state, false, false), 'none')
  assert.equal(decideChatScroll(hidden.state, true, false), 'none')
  const loading = enterChatVisibility(hidden.state, true, false)
  assert.equal(loading.action, 'wait')
  assert.equal(loading.state.initialized, false)
  const shown = enterChatVisibility(loading.state, true, true)
  assert.equal(shown.action, 'initialize')
  assert.equal(decideChatScroll(shown.state, false, false), 'bottom')
  assert.equal(enterChatVisibility(shown.state, true, true).action, 'none')
})

test('再表示時は土台の復元を待ち、隠れている間に伸びた末尾へ移動しない', () => {
  const initialized = enterChatVisibility(initialChatScrollState, true, true).state
  const hidden = enterChatVisibility(initialized, false, true).state
  const resume = enterChatVisibility(hidden, true, true)
  assert.equal(resume.action, 'resume')
  assert.equal(canObserveChatScroll(resume.state), false)
  assert.equal(decideChatScroll(resume.state, false, false), 'none')
  const restored = finishChatRestore(resume.state, { scrollTop: 300, clientHeight: 400, scrollHeight: 1300 })
  assert.equal(restored.following, false)
  assert.equal(canObserveChatScroll(restored), true)
  assert.equal(decideChatScroll(restored, false, false), 'none')
})

test('復元した位置が末尾なら、その後の新しい更新から追従を再開できる', () => {
  const initialized = enterChatVisibility(initialChatScrollState, true, true).state
  const hidden = enterChatVisibility(initialized, false, true).state
  const resume = enterChatVisibility(hidden, true, true).state
  const restored = finishChatRestore(resume, { scrollTop: 896, clientHeight: 400, scrollHeight: 1300 })
  assert.equal(restored.following, true)
  assert.equal(decideChatScroll(restored, false, false), 'bottom')
  assert.equal(finishChatRestore(hidden, { scrollTop: 900, clientHeight: 400, scrollHeight: 1300 }), hidden)
})

test('ページング中に隠れたら古いアンカーを捨て、非表示中の完了で復元待ちに詰まらない', () => {
  const initialized = enterChatVisibility(initialChatScrollState, true, true).state
  const reading = { ...initialized, following: false }
  assert.equal(decideChatScroll(reading, true, true), 'none')
  assert.equal(decideChatScroll(reading, true, false), 'anchor')
  const hidden = enterChatVisibility(reading, false, true).state
  assert.equal(shouldDiscardChatAnchor(hidden.active, hidden.restoring), true)
  assert.equal(decideChatScroll(hidden, true, false), 'none')
  const resume = enterChatVisibility(hidden, true, true).state
  assert.equal(shouldDiscardChatAnchor(resume.active, resume.restoring), true)
  const restored = finishChatRestore(resume, { scrollTop: 10, clientHeight: 400, scrollHeight: 1800 })
  assert.equal(restored.restoring, false)
  assert.equal(shouldDiscardChatAnchor(restored.active, restored.restoring), false)
  assert.equal(canObserveChatScroll(restored), true)
  assert.equal(decideChatScroll(restored, false, false), 'none')
  // A later user-triggered page request can again preserve its visible anchor.
  assert.equal(decideChatScroll(restored, true, false), 'anchor')
})

test('再表示フレームより先に再び非表示になっても、古い完了処理が追従を有効にしない', () => {
  const initialized = enterChatVisibility(initialChatScrollState, true, true).state
  const resume = enterChatVisibility(enterChatVisibility(initialized, false, true).state, true, true).state
  const hiddenAgain = enterChatVisibility(resume, false, true).state
  const late = finishChatRestore(hiddenAgain, { scrollTop: 900, clientHeight: 400, scrollHeight: 1300 })
  assert.equal(late, hiddenAgain)
  assert.equal(decideChatScroll(late, false, false), 'none')
  assert.equal(enterChatVisibility(late, true, true).action, 'resume')
})
