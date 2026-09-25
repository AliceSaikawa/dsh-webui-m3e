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

test('過去を読んでから隠した場合は、土台の復元後もその位置を保つ', () => {
  const initialized = enterChatVisibility(initialChatScrollState, true, true).state
  const hidden = enterChatVisibility({ ...initialized, following: false }, false, true).state
  const resume = enterChatVisibility(hidden, true, true)
  assert.equal(resume.action, 'resume')
  assert.equal(canObserveChatScroll(resume.state), false)
  assert.equal(decideChatScroll(resume.state, false, false), 'none')
  const result = finishChatRestore(resume.state)
  assert.equal(result.action, 'preserve')
  const restored = result.state
  assert.equal(restored.following, false)
  assert.equal(canObserveChatScroll(restored), true)
  assert.equal(decideChatScroll(restored, false, false), 'none')
})

test('追従したまま隠した場合は、復元後の最初のフレームで新しい末尾へ進む', () => {
  const initialized = enterChatVisibility(initialChatScrollState, true, true).state
  const hidden = enterChatVisibility(initialized, false, true).state
  const resume = enterChatVisibility(hidden, true, true).state
  // Content can grow by any amount while hidden: old distance from the end does
  // not override the following mode. No writes are allowed before this finish.
  assert.equal(decideChatScroll(hidden, false, false), 'none')
  assert.equal(decideChatScroll(resume, false, false), 'none')
  const result = finishChatRestore(resume)
  assert.equal(result.action, 'bottom')
  const restored = result.state
  assert.equal(restored.following, true)
  assert.equal(decideChatScroll(restored, false, false), 'bottom')
  assert.deepEqual(finishChatRestore(hidden), { state: hidden, action: 'none' })
  assert.deepEqual(finishChatRestore(restored), { state: restored, action: 'none' })
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
  const result = finishChatRestore(resume)
  assert.equal(result.action, 'preserve')
  const restored = result.state
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
  const late = finishChatRestore(hiddenAgain)
  assert.equal(late.state, hiddenAgain)
  assert.equal(late.action, 'none')
  assert.equal(decideChatScroll(late.state, false, false), 'none')
  const next = enterChatVisibility(late.state, true, true)
  assert.equal(next.action, 'resume')
  assert.equal(finishChatRestore(next.state).action, 'bottom')
})

test('復元フレームを待つ間の再評価・高さ待ちでも非表示前の追従状態を変えない', () => {
  for (const following of [true, false]) {
    const initialized = { ...enterChatVisibility(initialChatScrollState, true, true).state, following }
    const hidden = enterChatVisibility(initialized, false, true).state
    const waiting = enterChatVisibility(hidden, true, false)
    assert.equal(waiting.action, 'wait')
    const resuming = enterChatVisibility(waiting.state, true, true).state
    const repeated = enterChatVisibility(resuming, true, true).state
    assert.equal(repeated.following, following)
    assert.equal(decideChatScroll(repeated, false, false), 'none')
    assert.equal(finishChatRestore(repeated).action, following ? 'bottom' : 'preserve')
  }
})
