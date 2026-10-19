import assert from 'node:assert/strict'
import test from 'node:test'
import { createFrameThrottledWriter } from '../web/src/features/settings/frame-throttle.ts'

/** A writer over a manual frame clock, recording what reaches the sink. */
function setup() {
  const frames = new Map<number, () => void>()
  let next = 1
  const written: string[] = []
  const writer = createFrameThrottledWriter<string>(value => written.push(value), {
    request(callback) { frames.set(next, callback); return next++ },
    cancel(handle) { frames.delete(handle) },
  })
  const runFrame = () => {
    const due = [...frames.values()]
    frames.clear()
    due.forEach(callback => callback())
  }
  return { writer, written, frames, runFrame }
}

test('連続した throttled は 1 フレームに 1 回、最後の値だけを書く', () => {
  const { writer, written, frames, runFrame } = setup()
  writer.throttled('#000001')
  writer.throttled('#000002')
  writer.throttled('#000003')
  assert.deepEqual(written, [])
  assert.equal(frames.size, 1)
  runFrame()
  assert.deepEqual(written, ['#000003'])
  writer.throttled('#000004')
  runFrame()
  assert.deepEqual(written, ['#000003', '#000004'])
})

test('同じフレームで throttled のあとの immediate は、待っている値を捨てて上書きされない', () => {
  const { writer, written, frames, runFrame } = setup()
  writer.throttled('#00aa44')
  writer.immediate('#0b57d0')
  assert.deepEqual(written, ['#0b57d0'])
  assert.equal(frames.size, 0)
  runFrame()
  assert.deepEqual(written, ['#0b57d0'])
})

test('同じフレームで throttled → immediate → flush（閉じる）は、immediate の値だけを書く', () => {
  const { writer, written, frames, runFrame } = setup()
  writer.throttled('#00aa44')
  writer.immediate('#0b57d0')
  writer.flush()
  runFrame()
  assert.deepEqual(written, ['#0b57d0'])
  assert.equal(frames.size, 0)
})

test('最新の意図が throttled のままなら、flush で 1 回だけ書いてフレームを取り消す', () => {
  const { writer, written, frames, runFrame } = setup()
  writer.immediate('#0b57d0')
  writer.throttled('#00aa44')
  writer.throttled('#00aa45')
  writer.flush()
  assert.deepEqual(written, ['#0b57d0', '#00aa45'])
  assert.equal(frames.size, 0)
  runFrame()
  writer.flush()
  assert.deepEqual(written, ['#0b57d0', '#00aa45'])
})

test('フレームで書いたあとの flush は何も書かない', () => {
  const { writer, written, runFrame } = setup()
  writer.throttled('#00aa44')
  runFrame()
  writer.flush()
  assert.deepEqual(written, ['#00aa44'])
})
