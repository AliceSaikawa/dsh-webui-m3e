import assert from 'node:assert/strict'
import test from 'node:test'
import { hasOpenOverlay, openSheet } from '../web/src/app/overlay/store.ts'
import { closeTraceSheet } from '../web/src/features/trace/sheet-lifecycle.ts'

test('trace hiding or unmount cleanup closes only its sheet beneath an approval interruption', () => {
  const closeRecord = openSheet(null, { label: '記録の詳細', sessionId: 'former-session' })
  const owner = { current: closeRecord as (() => void) | undefined }
  const closeApproval = openSheet(null, { label: 'ツールの承認', sessionId: 'former-session', dismissible: false, interactionKey: 'approval-1' })
  try {
    closeTraceSheet(owner)
    assert.equal(owner.current, undefined)
    assert.equal(hasOpenOverlay(), true, 'leaving the trace must preserve the approval')
    closeApproval()
    assert.equal(hasOpenOverlay(), false, 'dismissing the approval must not reveal the former trace sheet')
  } finally { closeRecord(); closeApproval() }
})

test('an interruption alone preserves the trace sheet until its owner is hidden or removed', () => {
  const closeRecord = openSheet(null, { label: '記録の詳細', sessionId: 'same-session' })
  const owner = { current: closeRecord as (() => void) | undefined }
  const closeQuestion = openSheet(null, { label: '質問', sessionId: 'same-session', interactionKey: 'question-1' })
  try {
    closeQuestion()
    assert.equal(hasOpenOverlay(), true, 'the still-active trace keeps its detail after an interruption')
    closeTraceSheet(owner)
    assert.equal(hasOpenOverlay(), false)
  } finally { closeRecord(); closeQuestion() }
})

test('a manually dismissed trace handle cannot close a later unrelated sheet', () => {
  const closeRecord = openSheet(null, { label: '記録の詳細', sessionId: 'old-session' })
  const owner = { current: closeRecord as (() => void) | undefined }
  closeRecord()
  const closeOther = openSheet(null, { label: '別の会話の操作', sessionId: 'new-session' })
  try {
    closeTraceSheet(owner)
    closeRecord()
    assert.equal(hasOpenOverlay(), true, 'the original close function is scoped to its own store ID')
    closeOther()
    assert.equal(hasOpenOverlay(), false)
  } finally { closeRecord(); closeOther() }
})

test('repeated inactive and unmount cleanup releases the trace handle once', () => {
  const closeRecord = openSheet(null, { label: '記録の詳細' })
  let calls = 0
  const owner: { current: (() => void) | undefined } = { current: () => { calls++; closeRecord() } }
  try {
    closeTraceSheet(owner)
    closeTraceSheet(owner)
    assert.equal(calls, 1)
    assert.equal(hasOpenOverlay(), false)
    closeRecord()
    assert.equal(hasOpenOverlay(), false, 'the underlying store close is also idempotent')
  } finally { closeRecord() }
})

test('opening a replacement detail leaves one owned sheet for the next cleanup', () => {
  const closeFirst = openSheet(null, { label: '最初の記録' })
  const owner = { current: closeFirst as (() => void) | undefined }
  closeTraceSheet(owner)
  const closeSecond = openSheet(null, { label: '次の記録' })
  owner.current = closeSecond
  try {
    closeFirst()
    assert.equal(hasOpenOverlay(), true)
    closeTraceSheet(owner)
    assert.equal(hasOpenOverlay(), false)
  } finally { closeFirst(); closeSecond() }
})
