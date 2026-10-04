import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import type { ConnectionState, DshRemote, ObservableSnapshot } from '../web/src/dsh/services.ts'
import { watchGoalActivation, type GoalActivationLifecycle } from '../web/src/features/session-tools/goal-activation.ts'
import type { GoalActivationRef, GoalsRemote } from '../web/src/features/session-tools/operations.ts'

function source<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return { getSnapshot: () => value, subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } },
    set(next: T) { value = next; for (const fn of listeners) fn() }, count: () => listeners.size }
}
async function drain() { for (let i = 0; i < 10; i++) await Promise.resolve() }
function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const connection = source<ConnectionState>('connected')
  type State = GoalActivationLifecycle['session'] extends ObservableSnapshot<infer T> ? T : never
  const session = source<State>({ removed: false, openState: 'open', lastAgentError: null, running: false })
  const events = new Set<(event: unknown) => void>()
  const remote = { $on(_name: string, fn: (event: unknown) => void) { events.add(fn); return () => { events.delete(fn) } } } as unknown as DshRemote
  let reads = 0, failures = 0, ready = false, live: GoalActivationRef | undefined
  let pending: (() => Promise<unknown>) | undefined
  const goals = { async get() {
    reads++
    if (pending) return pending()
    return ready ? { ok: true, value: { id: 'goal', revision: 1, activation: 'disarmed' } }
      : { ok: false, error: { code: 'gateway/lookup-not-found', message: '準備前', details: {} } }
  } } as unknown as GoalsRemote
  const watcher = watchGoalActivation(remote, goals, 'session', value => { live = value }, () => { failures++ }, { connection, session })
  t.after(() => watcher.dispose())
  return { watcher, connection, session, events, reads: () => reads, failures: () => failures, live: () => live,
    ready() { ready = true }, pending(fn: () => Promise<unknown>) { pending = fn },
    async tick(ms: number) { t.mock.timers.tick(ms); await drain() } }
}

test('B2 準備の失敗で待機を止め、エラーが解消されたら読み直す', async t => {
  const f = fixture(t)
  await f.watcher.refresh()
  f.session.set({ ...f.session.getSnapshot(), lastAgentError: '準備に失敗しました' })
  await f.tick(3000)
  assert.equal(f.reads(), 1)
  assert.equal(f.failures(), 2)
  f.ready()
  f.session.set({ ...f.session.getSnapshot(), lastAgentError: null })
  await drain()
  assert.equal(f.live()?.id, 'goal')
})

test('B2 会話が削除されたら待機を止め、遅い応答も適用しない', async t => {
  const f = fixture(t)
  let finish!: (value: unknown) => void
  const response = new Promise(resolve => { finish = resolve })
  f.pending(() => response)
  const reading = f.watcher.refresh()
  f.session.set({ ...f.session.getSnapshot(), removed: true })
  finish({ ok: true, value: { id: 'removed', revision: 1, activation: 'armed' } })
  await reading
  await drain()
  await f.tick(3000)
  assert.equal(f.live(), undefined)
  assert.equal(f.reads(), 1)
  assert.equal(f.failures(), 1)
})

test('B2 切断中は待機を止め、再接続で新しい状態を取得する', async t => {
  const f = fixture(t)
  await f.watcher.refresh()
  f.connection.set('disconnected')
  await f.tick(3000)
  assert.equal(f.reads(), 1)
  f.ready()
  f.connection.set('connected')
  await drain()
  assert.equal(f.reads(), 2)
  assert.equal(f.live()?.activation, 'disarmed')
})

test('B2 過去の準備エラーを残して再接続しても、通知のない遅い成功で復帰する', async t => {
  const f = fixture(t)
  await f.watcher.refresh()
  f.session.set({ ...f.session.getSnapshot(), lastAgentError: '以前の準備に失敗しました' })
  f.connection.set('disconnected')
  await f.tick(3000)
  assert.equal(f.reads(), 1)
  f.connection.set('connected')
  await drain()
  assert.equal(f.reads(), 2)
  // Real reconnect/Agent addition leaves lastAgentError and running unchanged.
  // Preparation can succeed after three seconds without an activation event.
  for (let elapsed = 250; elapsed <= 3000; elapsed += 250) {
    if (elapsed === 3000) f.ready()
    await f.tick(250)
  }
  assert.equal(f.session.getSnapshot().lastAgentError, '以前の準備に失敗しました')
  assert.deepEqual(f.live(), { id: 'goal', revision: 1, activation: 'disarmed' })
})

test('B2 画面終了でタイマーと全購読を解放し、終了後は読み直さない', async t => {
  const f = fixture(t)
  const scheduled = new Set<ReturnType<typeof setTimeout>>()
  const schedule = globalThis.setTimeout, cancel = globalThis.clearTimeout
  t.mock.method(globalThis, 'setTimeout', (callback: () => void, delay?: number) => {
    const timer = schedule(() => { scheduled.delete(timer); callback() }, delay)
    scheduled.add(timer)
    return timer
  })
  t.mock.method(globalThis, 'clearTimeout', (timer: ReturnType<typeof setTimeout>) => {
    scheduled.delete(timer)
    cancel(timer)
  })
  await f.watcher.refresh()
  assert.equal(scheduled.size, 1)
  assert.equal(f.connection.count(), 1)
  assert.equal(f.session.count(), 1)
  assert.equal(f.events.size, 1)
  f.watcher.dispose()
  // Inspect the pending reservation before advancing time: the disposed RPC
  // guard alone would hide an uncancelled timeout after it fires.
  assert.equal(scheduled.size, 0)
  assert.equal(f.connection.count(), 0)
  assert.equal(f.session.count(), 0)
  assert.equal(f.events.size, 0)
  f.connection.set('disconnected')
  f.connection.set('connected')
  f.session.set({ ...f.session.getSnapshot(), running: true })
  await f.tick(3000)
  assert.equal(f.reads(), 1)
})
