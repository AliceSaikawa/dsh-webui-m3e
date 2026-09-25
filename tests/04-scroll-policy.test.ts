import assert from 'node:assert/strict'
import test from 'node:test'
import { rememberScrollPositions, restoreScrollPositions } from '../web/src/app/scroll-retention.ts'
import { isTraceAtBottom, traceScrollAction, type TraceScrollState } from '../web/src/features/trace/scroll-policy.ts'

const shown: TraceScrollState = {
  active: true, initialized: true, hasRows: true, visible: true,
  following: true, searching: false, hasAnchor: false, loadingOlder: false,
}

test('hidden trace never requests scrolling, including queued resize and prepend completion', () => {
  for (const trigger of ['activation', 'content', 'resize'] as const) {
    for (const initialized of [false, true]) {
      for (const hasAnchor of [false, true]) {
        assert.equal(traceScrollAction({ ...shown, active: false, initialized, hasAnchor }, trigger), 'none')
      }
    }
  }
})

test('first scroll waits for visible records and runs once on the first actual activation', () => {
  const initial = { ...shown, initialized: false }
  assert.equal(traceScrollAction({ ...initial, active: false }, 'content'), 'none')
  assert.equal(traceScrollAction({ ...initial, hasRows: false }, 'activation'), 'none')
  assert.equal(traceScrollAction({ ...initial, visible: false }, 'resize'), 'none')
  assert.equal(traceScrollAction(initial, 'activation'), 'bottom')
  assert.equal(traceScrollAction(shown, 'activation'), 'none')
  // A visible, initially empty session may receive records without a tab change.
  assert.equal(traceScrollAction(initial, 'content'), 'bottom')
})

test('a retained position is not overwritten by activation or its initial resize notification', () => {
  const node = {
    scrollTop: 720, scrollLeft: 12, scrollHeight: 1200, clientHeight: 480,
    scrollTo({ top, left }: { top: number; left: number; behavior: 'instant' }) {
      this.scrollTop = top
      this.scrollLeft = left
    },
  }
  const saved = rememberScrollPositions([node])
  // The session gains output while hidden and the browser clears its position.
  node.scrollTop = 0
  node.scrollLeft = 0
  node.scrollHeight = 2000
  assert.equal(traceScrollAction({ ...shown, active: false }, 'content'), 'none')
  restoreScrollPositions(saved, candidate => candidate === node)
  const restored = { ...shown, following: isTraceAtBottom(node.scrollTop, node.scrollHeight, node.clientHeight) }
  assert.equal(restored.following, false)
  assert.equal(traceScrollAction(restored, 'activation'), 'none')
  // Both passive activation and observe()'s first callback use this trigger.
  assert.equal(traceScrollAction(restored, 'activation'), 'none')
  assert.equal(traceScrollAction(restored, 'content'), 'none')
  assert.equal(traceScrollAction(restored, 'resize'), 'none')
  assert.equal(node.scrollTop, 720)
  assert.equal(node.scrollLeft, 12)
})

test('reactivation alone never follows, even if the saved position is still at the bottom', () => {
  assert.equal(traceScrollAction(shown, 'activation'), 'none')
  // Only subsequent content/size changes may follow from that restored position.
  assert.equal(traceScrollAction(shown, 'content'), 'bottom')
  assert.equal(traceScrollAction(shown, 'resize'), 'bottom')
})

test('scrolling up and filtering suppress follow while reading existing content', () => {
  for (const trigger of ['content', 'resize'] as const) {
    assert.equal(traceScrollAction({ ...shown, following: false }, trigger), 'none')
    assert.equal(traceScrollAction({ ...shown, searching: true }, trigger), 'none')
  }
  assert.equal(isTraceAtBottom(900, 1500, 500), false)
  assert.equal(isTraceAtBottom(960, 1500, 500), true)
  assert.equal(isTraceAtBottom(952, 1500, 500), false)
  assert.equal(isTraceAtBottom(0, 0, 0), false)
})

test('older-page anchors restore only while active, settled, and not on reactivation', () => {
  const pending = { ...shown, hasAnchor: true, loadingOlder: true }
  assert.equal(traceScrollAction(pending, 'content'), 'none')
  assert.equal(traceScrollAction({ ...pending, loadingOlder: false }, 'content'), 'anchor')
  assert.equal(traceScrollAction({ ...pending, loadingOlder: false }, 'activation'), 'none')
  assert.equal(traceScrollAction({ ...pending, active: false, loadingOlder: false }, 'resize'), 'none')
})
