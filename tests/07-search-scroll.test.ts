import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  connectSearchScroll,
  type SearchScrollRow,
  type SearchScrollScheduler,
} from '../web/src/features/search/search-scroll.ts'

function deferred() {
  let resolve!: () => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

/** Flush the short outer/inner Lit promise chain without a browser or timers. */
async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve() }

function frames() {
  let serial = 0
  const pending = new Map<number, () => void>()
  const scheduler: SearchScrollScheduler = {
    request(callback) { const id = ++serial; pending.set(id, callback); return id },
    cancel(id) { pending.delete(id) },
  }
  return {
    scheduler,
    get pending() { return pending.size },
    async tick() {
      const batch = [...pending.entries()]
      for (const [id, callback] of batch) {
        if (!pending.delete(id)) continue
        callback()
      }
      await settle()
    },
  }
}

class ScrollArea extends EventTarget {
  top = 0
  maximum = 1000
  writes: number[] = []
  get scrollTop() { return this.top }
  set scrollTop(value: number) {
    this.top = Math.max(0, Math.min(value, this.maximum))
    this.writes.push(this.top)
    this.dispatchEvent(new Event('scroll'))
  }
}

function fixture(rows: () => Iterable<SearchScrollRow> = () => []) {
  const area = new ScrollArea()
  const clock = frames()
  let saved = 480
  const savedValues: number[] = []
  const connection = connectSearchScroll({
    area, rows, getSaved: () => saved,
    setSaved(value) { saved = value; savedValues.push(value) },
    scheduler: clock.scheduler,
  })
  return {
    area, clock, connection, savedValues,
    get saved() { return saved },
    set saved(value: number) { saved = value },
  }
}

test('restoration waits for outer and inner Lit updates and deferred M3E row height', async () => {
  const outer = deferred()
  const inner = deferred()
  const action: { updateComplete: Promise<void>; button?: SearchScrollRow } = { updateComplete: outer.promise }
  const f = fixture(() => [action])
  f.area.maximum = 20
  await settle()
  assert.equal(f.clock.pending, 0)
  action.button = { updateComplete: inner.promise }
  outer.resolve()
  await settle()
  assert.equal(f.clock.pending, 0)
  inner.resolve()
  await settle()
  assert.equal(f.clock.pending, 1)

  // ResizeObserver runs after frame 1 and queues M3E's state writes after our
  // own callback in frame 2. A one- or two-frame restore would clamp to 20.
  await f.clock.tick()
  f.clock.scheduler.request(() => { f.area.maximum = 1000 })
  await f.clock.tick()
  assert.deepEqual(f.area.writes, [])
  await f.clock.tick()
  assert.deepEqual(f.area.writes, [480])
  assert.deepEqual(f.savedValues, [])
  await f.clock.tick()
  assert.deepEqual(f.savedValues, [480])
  f.area.scrollTop = 620
  assert.equal(f.saved, 620)
  f.connection.dispose()
})

test('mount-time scroll events and cleanup never replace an unrestored offset', async () => {
  const row = deferred()
  const f = fixture(() => [{ updateComplete: row.promise }])
  f.area.scrollTop = 14
  assert.equal(f.saved, 480)
  f.connection.dispose()
  assert.equal(f.saved, 480)
  row.resolve()
  await settle()
  assert.equal(f.clock.pending, 0)
  assert.deepEqual(f.savedValues, [])
})

test('cleanup cancels pending frames and keeps the intended offset until restoration settles', async () => {
  const f = fixture()
  await settle()
  await f.clock.tick()
  assert.equal(f.clock.pending, 1)
  f.connection.dispose()
  assert.equal(f.clock.pending, 0)
  await f.clock.tick()
  assert.deepEqual(f.area.writes, [])
  assert.equal(f.saved, 480)
  f.connection.dispose()
  f.area.scrollTop = 70
  assert.equal(f.saved, 480)
})

test('cleanup between the restore write and its scroll event keeps the original saved value', async () => {
  const f = fixture()
  f.area.maximum = 230
  await settle()
  for (let i = 0; i < 3; i++) await f.clock.tick()
  assert.equal(f.area.scrollTop, 230)
  f.connection.dispose()
  assert.equal(f.saved, 480)
  assert.equal(f.clock.pending, 0)
})

test('a completed restore can save a genuinely shorter result set after layout settles', async () => {
  const f = fixture()
  f.area.maximum = 230
  await settle()
  for (let i = 0; i < 4; i++) await f.clock.tick()
  assert.equal(f.saved, 230)
  f.connection.dispose()
})

for (const type of ['wheel', 'touchmove', 'pointerdown']) {
  test(`${type} cancels deferred restoration and user scrolling wins`, async () => {
    const f = fixture()
    await settle()
    f.area.dispatchEvent(new Event(type))
    assert.equal(f.clock.pending, 0)
    f.area.scrollTop = 86
    assert.equal(f.saved, 86)
    for (let i = 0; i < 4; i++) await f.clock.tick()
    assert.deepEqual(f.area.writes, [86])
    f.connection.dispose()
    assert.equal(f.saved, 86)
  })
}

test('scroll intent without a scroll does not save a partially rendered offset on cleanup', async () => {
  const f = fixture()
  await settle()
  f.area.dispatchEvent(new Event('wheel'))
  f.connection.dispose()
  assert.equal(f.saved, 480)
  assert.deepEqual(f.savedValues, [])
})

test('scroll keys cancel restoration but text-editing arrows do not', async () => {
  const f = fixture()
  await settle()
  const edit = new Event('keydown')
  Object.defineProperty(edit, 'key', { value: 'ArrowDown' })
  Object.defineProperty(edit, 'composedPath', { value: () => [{ tagName: 'INPUT' }, f.area] })
  f.area.dispatchEvent(edit)
  assert.equal(f.clock.pending, 1)
  const scroll = new Event('keydown')
  Object.defineProperty(scroll, 'key', { value: 'PageDown' })
  f.area.dispatchEvent(scroll)
  assert.equal(f.clock.pending, 0)
  f.area.scrollTop = 130
  assert.equal(f.saved, 130)
  f.connection.dispose()
})

test('reset for a new query cancels the old restore even if Lit completes later', async () => {
  const outer = deferred()
  const f = fixture(() => [{ updateComplete: outer.promise }])
  f.connection.reset()
  assert.equal(f.saved, 0)
  assert.equal(f.area.scrollTop, 0)
  outer.resolve()
  await settle()
  assert.equal(f.clock.pending, 0)
  assert.deepEqual(f.area.writes, [0])
  f.area.scrollTop = 42
  assert.equal(f.saved, 42)
  f.connection.dispose()
})

test('external changes to the saved value invalidate a pending restore without overwriting them', async () => {
  const f = fixture()
  await settle()
  await f.clock.tick()
  f.saved = 0
  await f.clock.tick()
  assert.equal(f.clock.pending, 0)
  assert.deepEqual(f.area.writes, [])
  f.area.dispatchEvent(new Event('scroll'))
  f.connection.dispose()
  assert.equal(f.saved, 0)
  assert.deepEqual(f.savedValues, [])
})

test('a failed row update keeps the saved position and still permits explicit user scrolling', async () => {
  const outer = deferred()
  const f = fixture(() => [{ updateComplete: outer.promise }])
  outer.reject(new Error('render failed'))
  await settle()
  assert.equal(f.clock.pending, 0)
  assert.equal(f.saved, 480)
  f.area.dispatchEvent(new Event('touchmove'))
  f.area.scrollTop = 74
  assert.equal(f.saved, 74)
  f.connection.dispose()
})
