import assert from 'node:assert/strict'
import test from 'node:test'
import { clearDraft, prepareDraftImages, readDraft, subscribeDraft, writeDraft } from '../web/src/features/composer/drafts.ts'
import type { PreparedImage } from '../web/src/features/composer/types.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
function picture(id: string): PreparedImage {
  return { id, name: `${id}.png`, previewUrl: 'data:image/png;base64,cGljdHVyZQ==', width: 1, height: 1,
    prompt: { type: 'image', mediaType: 'image/png', data: 'cGljdHVyZQ==' },
    attachment: { type: 'image', value: { previewUrl: 'data:image/png;base64,cGljdHVyZQ==' } } }
}

for (const text of ['画像と本文', '']) test(`画像準備中に購読し直しても進捗とプレビューを引き継ぐ（${text ? '本文あり' : '画像のみ'}）`, async () => {
  const key = `session:preparation-remount-${text.length}`
  writeDraft(key, { text, images: [] })
  let firstView = readDraft(key)
  const unsubscribe = subscribeDraft(key, () => { firstView = readDraft(key) })
  const task = deferred<PreparedImage>()
  const preparing = prepareDraftImages(key, [task], input => input.promise)
  assert.equal(firstView.preparingImages, 1)
  unsubscribe()
  // This is the getSnapshot/subscribe contract used by the replacement input.
  let replacementView = readDraft(key)
  const stop = subscribeDraft(key, () => { replacementView = readDraft(key) })
  try {
    assert.equal(replacementView.preparingImages, 1)
    assert.equal(replacementView.images.length, 0)
    const image = picture('remounted')
    task.resolve(image)
    await preparing
    assert.equal(replacementView, readDraft(key))
    assert.equal(replacementView.preparingImages, 0)
    assert.deepEqual(replacementView.images, [image])
    assert.equal(replacementView.text, text)
    assert.equal(firstView.images.length, 0)
    assert.ok(replacementView.text.trim() || replacementView.images.length)
  } finally { stop(); clearDraft(key) }
})

test('並行した画像準備は残り件数を維持し、途中の本文編集と別の下書きを保つ', async () => {
  const key = 'session:parallel-preparations'
  writeDraft(key, { text: '元の文章', images: [] })
  writeDraft('session:other-preparation', { text: '別の会話', images: [] })
  const first = deferred<PreparedImage>()
  const second = deferred<PreparedImage>()
  const a = prepareDraftImages(key, [first], input => input.promise)
  const b = prepareDraftImages(key, [second], input => input.promise)
  assert.equal(readDraft(key).preparingImages, 2)
  writeDraft(key, { ...readDraft(key), text: '読み込み中に直した文章' })
  first.resolve(picture('first'))
  await a
  assert.equal(readDraft(key).preparingImages, 1)
  const failed = new Error('画像を読み込めませんでした。')
  second.reject(failed)
  await b
  assert.equal(readDraft(key).preparingImages, 0)
  assert.equal(readDraft(key).imagePreparationError, failed)
  assert.equal(readDraft(key).text, '読み込み中に直した文章')
  assert.deepEqual(readDraft(key).images.map(image => image.id), ['first'])
  assert.deepEqual(readDraft('session:other-preparation'), { text: '別の会話', images: [] })
  clearDraft(key)
  clearDraft('session:other-preparation')
})

test('消した下書きの遅い画像処理は新しい下書きへ追加しない', async () => {
  const key = 'session:discarded-preparation'
  clearDraft(key)
  const old = deferred<PreparedImage>()
  const stale = prepareDraftImages(key, [old], input => input.promise)
  clearDraft(key)
  const current = deferred<PreparedImage>()
  const fresh = prepareDraftImages(key, [current], input => input.promise)
  old.resolve(picture('stale'))
  await stale
  assert.equal(readDraft(key).preparingImages, 1)
  assert.equal(readDraft(key).images.length, 0)
  current.resolve(picture('fresh'))
  await fresh
  assert.equal(readDraft(key).preparingImages, 0)
  assert.deepEqual(readDraft(key).images.map(image => image.id), ['fresh'])
  clearDraft(key)
})
