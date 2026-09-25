import assert from 'node:assert/strict'
import test from 'node:test'
import { createPreparedImage } from '../web/src/features/composer/image-content.ts'

test('暗号 API がなくても同じ画像の複数添付を識別でき、送信データとプレビューを保持する', t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'crypto', original)
    else Reflect.deleteProperty(globalThis, 'crypto')
  })
  const source = { name: '写真.png', previewUrl: 'data:image/png;base64,aW1hZ2U=', width: 10, height: 20, mediaType: 'image/png' }
  const images = Array.from({ length: 3 }, () => createPreparedImage(source))
  assert.equal(new Set(images.map(image => image.id)).size, 3)
  const retained = images.filter(image => image.id !== images[1]!.id)
  const addedAgain = createPreparedImage(source)
  assert.equal(new Set([...images, addedAgain].map(image => image.id)).size, 4)
  assert.equal(retained.length, 2)
  for (const image of [...retained, addedAgain]) {
    assert.deepEqual(image.prompt, { type: 'image', mediaType: 'image/png', data: 'aW1hZ2U=', name: '写真.png' })
    assert.deepEqual(image.attachment, { type: 'image', value: { previewUrl: source.previewUrl, name: source.name, width: 10, height: 20 } })
    assert.equal(image.previewUrl, source.previewUrl)
  }
})

test('変換後の画像データが空または未対応なら添付を作らない', () => {
  const input = { name: '写真', previewUrl: 'data:image/png;base64,aW1hZ2U=', width: 10, height: 20, mediaType: 'image/png' }
  for (const previewUrl of ['', 'data:image/png', 'data:image/png;base64,', 'data:image/png,aW1hZ2U=']) {
    assert.throws(() => createPreparedImage({ ...input, previewUrl }), /画像のデータを読み取れませんでした/u)
  }
  assert.throws(() => createPreparedImage({ ...input, mediaType: 'image/heic' }), /この画像形式には対応していません/u)
})
