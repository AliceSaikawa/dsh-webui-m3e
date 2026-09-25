import assert from 'node:assert/strict'
import test from 'node:test'
import { rememberScrollPositions, restoreScrollPositions } from '../web/src/app/scroll-retention.ts'

function target(scrollTop: number, scrollLeft = 0) {
  return {
    scrollTop, scrollLeft, restored: 0,
    scrollTo(options: { top: number; left: number; behavior: 'instant' }) {
      assert.equal(options.behavior, 'instant')
      this.scrollTop = options.top
      this.scrollLeft = options.left
      this.restored++
    },
  }
}

test('非表示で位置が失われても、パネルと内部スクロールをそれぞれ復元する', () => {
  const panel = target(140)
  const nested = target(560, 32)
  const atStart = target(0)
  const saved = rememberScrollPositions([panel, nested, atStart])
  panel.scrollTop = 0
  nested.scrollTop = 0
  nested.scrollLeft = 0
  restoreScrollPositions(saved, () => true)
  assert.equal(panel.scrollTop, 140)
  assert.equal(nested.scrollTop, 560)
  assert.equal(nested.scrollLeft, 32)
  assert.equal(atStart.restored, 0)
})

test('離脱した要素には復元せず、別のパネルの位置と混ざらない', () => {
  const chat = target(120)
  const removed = target(360)
  const trace = target(800)
  const chatPositions = rememberScrollPositions([chat, removed])
  const tracePositions = rememberScrollPositions([trace])
  chat.scrollTop = 0
  removed.scrollTop = 0
  trace.scrollTop = 0
  restoreScrollPositions(chatPositions, (node) => node === chat)
  assert.equal(chat.scrollTop, 120)
  assert.equal(removed.restored, 0)
  assert.equal(trace.scrollTop, 0)
  restoreScrollPositions(tracePositions, (node) => node === trace)
  assert.equal(trace.scrollTop, 800)
})
