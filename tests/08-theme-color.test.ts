import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_THEME_COLOR, getThemeColor, normalizeThemeColor, setThemeColor } from '../web/src/app/theme/appearance.ts'

test('normalizeThemeColor は #rrggbb だけを受け付け、小文字にそろえる', () => {
  assert.equal(normalizeThemeColor('#0B57D0'), '#0b57d0')
  assert.equal(normalizeThemeColor('#ABCDEF'), '#abcdef')
  assert.equal(normalizeThemeColor(DEFAULT_THEME_COLOR), '#6750a4')
  for (const value of ['0b57d0', '#0b57d', '#0b57d0f', 'red', '#gggggg', '#12345', '', null, undefined, 42, {}]) {
    assert.equal(normalizeThemeColor(value), undefined)
  }
})

interface Stub {
  events: string[]
  restore(): void
}

/** Install the two browser globals the appearance store reads at call time. */
function installBrowser(storage: () => unknown): Stub {
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const savedStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const events: string[] = []
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { addEventListener() {}, removeEventListener() {}, dispatchEvent(event: Event) { events.push(event.type) } },
  })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: storage })
  return {
    events,
    restore() {
      if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow)
      else Reflect.deleteProperty(globalThis, 'window')
      if (savedStorage) Object.defineProperty(globalThis, 'localStorage', savedStorage)
      else Reflect.deleteProperty(globalThis, 'localStorage')
    },
  }
}

function memoryStorage(entries: Map<string, string>) {
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value) },
    removeItem: (key: string) => { entries.delete(key) },
  }
}

test('選んだ画面の色をこの端末に保存し、読み戻してほかの端末設定と同じイベントで知らせる', () => {
  const entries = new Map<string, string>()
  const browser = installBrowser(() => memoryStorage(entries))
  try {
    setThemeColor('#0B57D0')
    assert.equal(entries.get('dsh-m3e-theme-color'), '#0b57d0')
    assert.equal(getThemeColor(), '#0b57d0')
    assert.deepEqual(browser.events, ['m3e:appearance'])
  } finally { browser.restore() }
})

test('保存された値がないとき・壊れているときは既定の色にする', () => {
  const entries = new Map<string, string>()
  const browser = installBrowser(() => memoryStorage(entries))
  try {
    assert.equal(getThemeColor(), DEFAULT_THEME_COLOR.toLowerCase())
    entries.set('dsh-m3e-theme-color', 'not-a-color')
    assert.equal(getThemeColor(), DEFAULT_THEME_COLOR.toLowerCase())
  } finally { browser.restore() }
})

test('壊れた色は保存せず、イベントも出さない', () => {
  const entries = new Map<string, string>()
  const browser = installBrowser(() => memoryStorage(entries))
  try {
    setThemeColor('not-a-color')
    assert.equal(entries.has('dsh-m3e-theme-color'), false)
    assert.deepEqual(browser.events, [])
  } finally { browser.restore() }
})

test('保存領域が使えなくても、選んだ色は端末内のメモリに残る', () => {
  const browser = installBrowser(() => { throw new Error('保存領域を利用できません') })
  try {
    setThemeColor('#B3261E')
    assert.equal(getThemeColor(), '#b3261e')
  } finally { browser.restore() }
})
