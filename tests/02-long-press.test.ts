import assert from 'node:assert/strict'
import test from 'node:test'
import { beginChatLongPress } from '../web/src/features/chat/long-press.ts'

function pointer(type: string, pointerId: number): Event {
  const event = new Event(type)
  Object.defineProperty(event, 'pointerId', { value: pointerId })
  return event
}
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

test('長押し後の指離しでシート側へ向かう最初のクリックだけを止める', async () => {
  const documentTarget = new EventTarget()
  let opened = 0
  let outsideClicks = 0
  const press = beginChatLongPress(documentTarget, 7, () => opened++, 5, 30)
  await wait(10)
  assert.equal(opened, 1)
  assert.equal(press.didFire(), true)
  // Node's EventTarget ignores capture priority, so register the simulated
  // sheet listener after the document guard to model browser propagation.
  documentTarget.addEventListener('click', () => outsideClicks++)
  // The message can receive pointerleave when the sheet appears. Finishing the
  // hold must keep the document capture guard through the release click.
  press.finish()
  documentTarget.dispatchEvent(pointer('pointerup', 7))
  const releaseClick = new Event('click', { cancelable: true })
  documentTarget.dispatchEvent(releaseClick)
  assert.equal(releaseClick.defaultPrevented, true)
  assert.equal(outsideClicks, 0)
  documentTarget.dispatchEvent(new Event('click', { cancelable: true }))
  assert.equal(outsideClicks, 1)
})

test('短いタップはシートを開かず、通常のクリックを残す', async () => {
  const documentTarget = new EventTarget()
  let opened = 0
  let clicks = 0
  documentTarget.addEventListener('click', () => clicks++)
  const press = beginChatLongPress(documentTarget, 3, () => opened++, 5)
  press.finish()
  documentTarget.dispatchEvent(pointer('pointerup', 3))
  documentTarget.dispatchEvent(new Event('click', { cancelable: true }))
  await wait(10)
  assert.equal(opened, 0)
  assert.equal(press.didFire(), false)
  assert.equal(clicks, 1)
})

test('スクロールによる10px超の移動は長押しを取り消し、クリックを妨げない', async () => {
  const documentTarget = new EventTarget()
  let opened = 0
  let clicks = 0
  documentTarget.addEventListener('click', () => clicks++)
  const press = beginChatLongPress(documentTarget, 5, () => opened++, 5)
  press.move(0, 11)
  await wait(10)
  assert.equal(opened, 0)
  assert.equal(press.didFire(), false)
  documentTarget.dispatchEvent(new Event('click', { cancelable: true }))
  assert.equal(clicks, 1)
})

test('解放クリックが発生しなくてもガードは短時間で消え、cancelも解除する', async () => {
  const documentTarget = new EventTarget()
  let clicks = 0
  documentTarget.addEventListener('click', () => clicks++)
  const press = beginChatLongPress(documentTarget, 8, () => {}, 5, 5)
  await wait(10)
  documentTarget.dispatchEvent(pointer('pointerup', 8))
  await wait(15)
  documentTarget.dispatchEvent(new Event('click', { cancelable: true }))
  assert.equal(clicks, 1)
  press.cancel()
  const second = beginChatLongPress(documentTarget, 9, () => {}, 5)
  await wait(10)
  second.cancel()
  documentTarget.dispatchEvent(new Event('click', { cancelable: true }))
  assert.equal(clicks, 2)
})
