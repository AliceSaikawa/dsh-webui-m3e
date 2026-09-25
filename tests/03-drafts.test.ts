import assert from 'node:assert/strict'
import test from 'node:test'
import { clearDraft, readDraft, writeDraft } from '../web/src/features/composer/drafts.ts'

test('端末の下書きを会話ごとに復元し、送った会話だけ消す', () => {
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const savedStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const entries = new Map([['m3e:composer:session:saved-one', '保存した文章\n次の行'], ['m3e:composer:session:saved-two', '別の会話']])
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value) },
    removeItem: (key: string) => { entries.delete(key) },
  } })
  try {
    assert.equal(readDraft('session:saved-one').text, '保存した文章\n次の行')
    writeDraft('session:saved-one', { text: '編集した文章', images: [], plan: true })
    assert.equal(entries.get('m3e:composer:session:saved-one'), '編集した文章')
    assert.equal(readDraft('session:saved-two').text, '別の会話')
    clearDraft('session:saved-one')
    assert.equal(entries.has('m3e:composer:session:saved-one'), false)
    assert.equal(entries.get('m3e:composer:session:saved-two'), '別の会話')
    // A denied storage area still keeps a usable in-memory draft.
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('保存領域を利用できません') } })
    writeDraft('session:storage-off', { text: '端末内のメモリに保持', images: [] })
    assert.equal(readDraft('session:storage-off').text, '端末内のメモリに保持')
    assert.equal(readDraft('session:storage-off-empty').text, '')
  } finally {
    if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    if (savedStorage) Object.defineProperty(globalThis, 'localStorage', savedStorage)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})
