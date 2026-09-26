import assert from 'node:assert/strict'
import test from 'node:test'
import { beginLongPress } from '../web/src/features/home/press.ts'

function pointer(type: string, id: number): Event {
  return Object.assign(new Event(type), { pointerId: id })
}

test('長押しで開いたシートは、離した指の外側クリックでは閉じない', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const document = new EventTarget()
  let opened = 0, outsideClicks = 0
  const press = beginLongPress(document, 1, () => {
    opened++
    // The sheet installs its outside-click listener only after opening.
    document.addEventListener('click', () => { outsideClicks++ })
  })
  t.mock.timers.tick(499)
  assert.equal(opened, 0)
  t.mock.timers.tick(1)
  assert.equal(opened, 1)
  document.dispatchEvent(pointer('pointerup', 1))
  press.finish()
  const releaseClick = new Event('click', { cancelable: true })
  document.dispatchEvent(releaseClick)
  assert.equal(releaseClick.defaultPrevented, true)
  assert.equal(outsideClicks, 0)
  const nextClick = new Event('click', { cancelable: true })
  document.dispatchEvent(nextClick)
  assert.equal(nextClick.defaultPrevented, false)
  assert.equal(outsideClicks, 1)
})

test('短いタップはシートを開かず、会話を開くクリックを通す', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const document = new EventTarget()
  let sheets = 0, conversations = 0
  document.addEventListener('click', () => { conversations++ })
  const press = beginLongPress(document, 2, () => { sheets++ })
  t.mock.timers.tick(100)
  document.dispatchEvent(pointer('pointerup', 2))
  press.finish()
  document.dispatchEvent(new Event('click', { cancelable: true }))
  t.mock.timers.tick(500)
  assert.equal(sheets, 0)
  assert.equal(conversations, 1)
})

test('スクロールで移動・中断した押下は長押しとして扱わない', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const document = new EventTarget()
  let sheets = 0
  const press = beginLongPress(document, 3, () => { sheets++ })
  t.mock.timers.tick(200)
  press.cancel()
  document.dispatchEvent(pointer('pointercancel', 3))
  t.mock.timers.tick(500)
  assert.equal(sheets, 0)
  const click = new Event('click', { cancelable: true })
  document.dispatchEvent(click)
  assert.equal(click.defaultPrevented, false)
})

test('離した後にクリックが発生しなくても次の操作は妨げない', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const document = new EventTarget()
  const press = beginLongPress(document, 4, () => {})
  t.mock.timers.tick(500)
  document.dispatchEvent(pointer('pointerup', 4))
  press.finish()
  t.mock.timers.tick(100)
  const nextClick = new Event('click', { cancelable: true })
  document.dispatchEvent(nextClick)
  assert.equal(nextClick.defaultPrevented, false)
})
