import assert from 'node:assert/strict'
import test from 'node:test'
import { rememberScrollPositions, restoreScrollPositions } from '../web/src/app/scroll-retention.ts'
import { isTraceAtBottom, traceFollowAfterScroll, traceScrollAction, type TraceScrollState } from '../web/src/features/trace/scroll-policy.ts'

const shown: TraceScrollState = {
  active: true, initialized: true, hasRows: true, visible: true,
  following: true, searching: false, hasAnchor: false, loadingOlder: false,
}

test('hidden trace never requests scrolling, including queued resize and prepend completion', () => {
  for (const trigger of ['activation', 'content', 'resize', 'search'] as const) {
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

test('search changes reveal the first match and clearing reveals the full history end', () => {
  for (const initialized of [false, true]) {
    for (const following of [false, true]) {
      const state = { ...shown, initialized, following }
      assert.equal(traceScrollAction({ ...state, searching: true }, 'search'), 'top')
      assert.equal(traceScrollAction({ ...state, searching: false }, 'search'), 'bottom')
    }
  }
  // A search change supersedes the old result set's pending page anchor.
  const oldAnchor = { ...shown, hasAnchor: true, loadingOlder: true }
  assert.equal(traceScrollAction({ ...oldAnchor, searching: true }, 'search'), 'top')
  assert.equal(traceScrollAction({ ...oldAnchor, searching: false }, 'search'), 'bottom')
})

test('filtering stops follow and clearing resumes follow after reaching the true bottom', () => {
  const filtering = { ...shown, following: false, searching: true }
  assert.equal(traceScrollAction(filtering, 'search'), 'top')
  for (const trigger of ['content', 'resize'] as const) {
    assert.equal(traceScrollAction(filtering, trigger), 'none')
    // A filtered list can fit the viewport and emit a bottom scroll event.
    assert.equal(traceScrollAction({ ...filtering, following: true }, trigger), 'none')
  }

  const cleared = { ...filtering, searching: false }
  assert.equal(traceScrollAction(cleared, 'search'), 'bottom')
  const atEnd = { ...cleared, following: isTraceAtBottom(1500, 2000, 500) }
  assert.equal(atEnd.following, true)
  assert.equal(traceScrollAction(atEnd, 'content'), 'bottom')
  assert.equal(traceScrollAction(atEnd, 'resize'), 'bottom')
})

test('hidden search changes cannot move the retained position or act on invisible content', () => {
  for (const searching of [false, true]) {
    const state = { ...shown, searching }
    assert.equal(traceScrollAction({ ...state, active: false }, 'search'), 'none')
    assert.equal(traceScrollAction({ ...state, visible: false }, 'search'), 'none')
    assert.equal(traceScrollAction({ ...state, hasRows: false }, 'search'), 'none')
  }
})

test('clearing a search stays at the end while long rows finish growing', () => {
  const viewport = { scrollTop: 0, scrollHeight: 900, clientHeight: 500 }
  const action = traceScrollAction({ ...shown, searching: false, following: true }, 'search')
  assert.equal(action, 'bottom')
  viewport.scrollTop = viewport.scrollHeight - viewport.clientHeight

  // The list host has rendered, but its custom-element rows obtain height later.
  for (const nextHeight of [1800, 3100, 4200]) {
    viewport.scrollHeight = nextHeight
    const atBottom = isTraceAtBottom(viewport.scrollTop, viewport.scrollHeight, viewport.clientHeight)
    assert.equal(atBottom, false)
    const following = traceFollowAfterScroll(true, atBottom, 'scroll')
    assert.equal(following, true, 'a layout-induced scroll must not cancel the requested follow')
    assert.equal(traceScrollAction({ ...shown, following }, 'resize'), 'bottom')
    viewport.scrollTop = viewport.scrollHeight - viewport.clientHeight
    assert.equal(isTraceAtBottom(viewport.scrollTop, viewport.scrollHeight, viewport.clientHeight), true)
  }
})

test('an upward gesture stops following until the user returns to the end', () => {
  const stopped = traceFollowAfterScroll(true, false, 'user-up')
  assert.equal(stopped, false)
  assert.equal(traceFollowAfterScroll(stopped, false, 'scroll'), false)
  assert.equal(traceScrollAction({ ...shown, following: stopped }, 'resize'), 'none')
  assert.equal(traceFollowAfterScroll(stopped, true, 'scroll'), true)
  assert.equal(traceScrollAction(shown, 'resize'), 'bottom')
})
