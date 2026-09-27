import assert from 'node:assert/strict'
import test from 'node:test'
import { closeOverlaysOutsideRoute, getOverlays, openDialog, openSheet, overlayOwnerForRoute } from '../web/src/app/overlay/store.ts'
import { hideSheet, keepTopInteractive, OverlayPresentation, setSheetHandle, type OverlaySurface } from '../web/src/app/overlay/presentation.ts'

const tick = () => new Promise<void>(resolve => setImmediate(resolve))
function cleanup() { for (const entry of getOverlays()) entry.close() }

test('会話が同じなら補助画面・トレース間で保持し、別会話と一覧では閉じる', () => {
  try {
    openSheet('分岐', { owner: { kind: 'conversation', sessionId: 'a/b' } })
    const entry = getOverlays()[0]
    for (const path of ['/s/a%2Fb', '/s/a%2Fb/trace', '/s/a%2Fb/files?path=README.md']) {
      closeOverlaysOutsideRoute(path)
      assert.equal(getOverlays()[0], entry)
    }
    closeOverlaysOutsideRoute('/s/other')
    assert.equal(getOverlays().length, 0)
    openSheet('詳細', { owner: { kind: 'conversation', sessionId: 'a' } })
    closeOverlaysOutsideRoute('/')
    assert.equal(getOverlays().length, 0)
  } finally { cleanup() }
})

test('ルートの持ち主はクエリも区別し、閉じる対象をまとめて除く', () => {
  try {
    openSheet('キー入力', { owner: { kind: 'route', path: '/settings/providers?key=a' } })
    openDialog('削除確認', { owner: { kind: 'route', path: '/settings/providers?key=a' } })
    closeOverlaysOutsideRoute('#/settings/providers?key=a')
    assert.equal(getOverlays().length, 2)
    closeOverlaysOutsideRoute('/settings/providers?key=b')
    assert.equal(getOverlays().length, 0)
  } finally { cleanup() }
})

test('末尾スラッシュ・空白の符号化が変わっても同じルートのシートを保つ', () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { hash: '#/settings/providers/?name=a%20b' } } })
  try {
    openSheet('入力中')
    const entry = getOverlays()[0]
    assert.deepEqual(entry?.owner, { kind: 'route', path: '/settings/providers?name=a+b' })
    closeOverlaysOutsideRoute('/settings/providers?name=a+b')
    assert.equal(getOverlays()[0], entry)
    closeOverlaysOutsideRoute('/settings/providers?name=a+c')
    assert.equal(getOverlays().length, 0)
  } finally { cleanup(); Reflect.deleteProperty(globalThis, 'window') }
})

test('持ち主省略は開いたURLを使い、要求先sessionIdとは混同しない', () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { hash: '#/inbox' } } })
  try {
    openSheet('承認', { sessionId: 'a', interactionKey: 'request', dismissible: false })
    assert.deepEqual(getOverlays()[0]?.owner, { kind: 'route', path: '/inbox' })
    closeOverlaysOutsideRoute('/inbox')
    assert.equal(getOverlays().length, 1)
    closeOverlaysOutsideRoute('/s/a')
    assert.equal(getOverlays().length, 0)
    assert.deepEqual(overlayOwnerForRoute('#/s/a/files?path=x'), { kind: 'conversation', sessionId: 'a' })
    assert.deepEqual(overlayOwnerForRoute('/s/%zz'), { kind: 'route', path: '/s/%zz' })
  } finally { cleanup(); Reflect.deleteProperty(globalThis, 'window') }
})

test('割り込みは下の面のteardown完了を待ち、同じ面の状態を保って戻る', async () => {
  const log: string[] = []
  let finishClose!: () => void
  const lowerState = { value: '入力中', result: '' }
  const lower: OverlaySurface = {
    async show() { log.push('lower:show') },
    async hide() { log.push('lower:closing'); await new Promise<void>(resolve => { finishClose = resolve }); log.push('lower:closed') },
  }
  const upper: OverlaySurface = { async show() { log.push('upper:show') }, async hide() { log.push('upper:closed') } }
  const presentation = new OverlayPresentation(id => log.push(`released:${id}`))
  presentation.register(1, lower)
  presentation.register(2, upper)
  presentation.select(1)
  await tick()
  presentation.select(2)
  await tick()
  assert.deepEqual(log, ['lower:show', 'lower:closing'])
  assert.equal(presentation.isUserClose(1), false)
  lowerState.result = '分岐完了'
  finishClose()
  await tick()
  assert.deepEqual(log, ['lower:show', 'lower:closing', 'lower:closed', 'released:1', 'upper:show'])
  presentation.select(1)
  await tick()
  assert.equal(log.at(-1), 'lower:show')
  assert.deepEqual(lowerState, { value: '入力中', result: '分岐完了' })
  assert.equal(presentation.isUserClose(1), true)
})

test('閉じる最中のルート離脱では、待っていた割り込みを開かない', async () => {
  const log: string[] = []
  let finish!: () => void
  const presentation = new OverlayPresentation(() => {})
  presentation.register(1, { async show() {}, async hide() { await new Promise<void>(resolve => { finish = resolve }) } })
  presentation.register(2, { async show() { log.push('opened') }, async hide() {} })
  presentation.select(1)
  await tick()
  presentation.select(2)
  presentation.select(undefined)
  finish()
  await tick()
  assert.equal(presentation.activeId, undefined)
  assert.deepEqual(log, [])
})

test('新しいsheetは前の終了まで作らず、初回の遅いcloseで開いた面を閉じない', async () => {
  let finishPrevious!: () => void
  let initialCloseStarted = false
  let visible = false
  const presentation = new OverlayPresentation(() => {})
  presentation.register(1, {
    async show() {},
    async hide() { await new Promise<void>(resolve => { finishPrevious = resolve }) },
  })
  presentation.select(1)
  await tick()
  presentation.select(2)
  await tick()
  assert.equal(presentation.shouldMount(2, 2), false)
  finishPrevious()
  await tick()
  assert.equal(presentation.shouldMount(2, 2), true)

  // A newly mounted element only enters its initial close path if still closed
  // at its first update. Registration opens it synchronously in this handoff.
  const next: OverlaySurface = {
    async show() { visible = true },
    async hide() { visible = false },
  }
  presentation.register(2, next)
  queueMicrotask(() => {
    if (visible) return
    initialCloseStarted = true
    setTimeout(() => { visible = false }, 30)
  })
  await new Promise(resolve => setTimeout(resolve, 40))
  assert.equal(initialCloseStarted, false)
  assert.equal(visible, true)
})

test('sheetの早いclosedイベントではなくpopoverの終了まで待つ', async () => {
  class Sheet extends EventTarget {
    open = true
    visible = true
    updateComplete = Promise.resolve()
    matches() { return this.visible }
  }
  const sheet = new Sheet()
  let done = false
  const closed = hideSheet(sheet).then(() => { done = true })
  sheet.dispatchEvent(new Event('closed'))
  await tick()
  assert.equal(done, false)
  sheet.visible = false
  sheet.dispatchEvent(new Event('toggle'))
  await closed
  assert.equal(done, true)
  assert.equal(sheet.open, false)
})

test('通常sheetのhandleは実際のHTML属性にも付ける', () => {
  const attributes = new Set<string>()
  const node = { toggleAttribute(name: string, force?: boolean) { if (force) attributes.add(name); else attributes.delete(name); return !!force } }
  setSheetHandle(node, true)
  assert.equal(attributes.has('handle'), true)
  setSheetHandle(node, false)
  assert.equal(attributes.has('handle'), false)
})

test('最上位の面は後からinertを付けられても操作可能に戻し、隠すと監視を止める', () => {
  const surface = { inert: true }
  let notify = () => {}
  let observing = true
  const stop = keepTopInteractive(surface, callback => {
    notify = () => { if (observing) callback() }
    return () => { observing = false }
  })
  assert.equal(surface.inert, false)
  surface.inert = true
  notify()
  assert.equal(surface.inert, false)
  stop()
  surface.inert = true
  notify()
  assert.equal(surface.inert, true)
})

test('返事が必須の下のシートは割り込み後も残り、閉じられない設定を保つ', () => {
  try {
    const closeRequired = openSheet('承認', { dismissible: false })
    const required = getOverlays()[0]
    assert.equal(required?.dismissible, false)
    const closeTop = openSheet('割り込み')
    assert.equal(getOverlays()[0], required)
    closeTop()
    assert.deepEqual(getOverlays(), [required])
    closeRequired()
    assert.equal(getOverlays().length, 0)
  } finally { cleanup() }
})
