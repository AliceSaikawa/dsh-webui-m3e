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
  type State = (GoalActivationLifecycle['session'] extends ObservableSnapshot<infer T> ? T : never) & { lastAgentError: string | null }
  const session = source<State>({ removed: false, openState: 'open', lastAgentError: null, running: false })
  const projection = source<unknown>({ goal: { id: 'goal', revision: 1 } })
  const events = new Map<string, (...args: unknown[]) => void>()
  const remote = { $on(name: string, fn: (...args: unknown[]) => void) { events.set(name, fn); return () => { events.delete(name) } } } as unknown as DshRemote
  let reads = 0, failures = 0, ready = false, live: GoalActivationRef | undefined
  const publications: (GoalActivationRef | undefined)[] = []
  let pending: (() => Promise<unknown>) | undefined
  const goals = { async get() {
    reads++
    if (pending) return pending()
    return ready ? { ok: true, value: { id: 'goal', revision: 1, activation: 'disarmed' } }
      : { ok: false, error: { code: 'gateway/lookup-not-found', message: '準備前', details: {} } }
  } } as unknown as GoalsRemote
  const watcher = watchGoalActivation(remote, goals, 'session', value => { live = value; publications.push(value) }, () => { failures++ }, { connection, session, projection })
  t.after(() => watcher.dispose())
  return { watcher, connection, session, projection, events, publications, reads: () => reads, failures: () => failures, live: () => live,
    emit(name: string, ...args: unknown[]) { events.get(name)?.(...args) },
    ready() { ready = true }, pending(fn: () => Promise<unknown>) { pending = fn },
    async tick(ms: number) { t.mock.timers.tick(ms); await drain() } }
}

test('B2 同じ文言の失敗を再接続後に受けても現在の読取りを無効にして停止する', async t => {
  const f = fixture(t)
  await f.watcher.refresh()
  const message = '準備に失敗しました'
  f.session.set({ ...f.session.getSnapshot(), lastAgentError: message })
  f.emit('api-session/error', 'session', message)
  f.connection.set('disconnected')
  f.connection.set('connected')
  await drain()
  let finish!: (value: unknown) => void
  f.pending(() => new Promise(resolve => { finish = resolve }))
  const reading = f.watcher.refresh()
  const failures = f.failures()
  f.session.set({ ...f.session.getSnapshot(), lastAgentError: message })
  f.emit('api-session/error', 'session', message)
  assert.equal(f.failures(), failures + 1)
  finish({ ok: true, value: { id: 'stale', revision: 1, activation: 'armed' } })
  await reading
  assert.equal(f.live(), undefined)
  const reads = f.reads()
  for (let i = 0; i < 40; i++) await f.tick(250)
  assert.equal(f.reads(), reads)
})

test('B2 未準備のまま1時間経っても自動再試行せず、手動で読み直せる', async t => {
  const f = fixture(t)
  await f.watcher.refresh()
  for (let i = 0; i < 14400; i++) await f.tick(250)
  assert.equal(f.reads(), 1)
  assert.equal(f.live(), undefined)
  f.ready()
  await f.watcher.refresh()
  assert.equal(f.reads(), 2)
  assert.equal(f.live()?.activation, 'disarmed')
})

test('B2 準備の失敗で待機を止め、Agentの準備完了通知で読み直す', async t => {
  const f = fixture(t)
  await f.watcher.refresh()
  f.session.set({ ...f.session.getSnapshot(), lastAgentError: '準備に失敗しました' })
  f.emit('api-session/error', 'session', '準備に失敗しました')
  await f.tick(3000)
  assert.equal(f.reads(), 1)
  assert.equal(f.failures(), 2)
  f.ready()
  f.session.set({ ...f.session.getSnapshot(), lastAgentError: null })
  f.emit('api-session/added', { sessionId: 'session', agentAvailable: true })
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
  f.emit('goal/activation-changed', { sessionId: 'session', goal: { id: 'removed', revision: 1, activation: 'armed' } })
  assert.equal(f.publications.length, 0, '削除後の activation 通知は公開しない')
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
  f.emit('goal/activation-changed', { sessionId: 'session', goal: { id: 'goal', revision: 1, activation: 'armed' } })
  assert.equal(f.publications.length, 0, '切断中の activation 通知は公開しない')
  await f.tick(3000)
  assert.equal(f.reads(), 1)
  f.ready()
  f.connection.set('connected')
  await drain()
  assert.equal(f.reads(), 2)
  assert.equal(f.live()?.activation, 'disarmed')
})

test('B2 過去の準備エラーを残して再接続しても、activation不変の遅い成功で復帰する', async t => {
  const f = fixture(t)
  await f.watcher.refresh()
  f.session.set({ ...f.session.getSnapshot(), lastAgentError: '以前の準備に失敗しました' })
  f.emit('api-session/error', 'session', '以前の準備に失敗しました')
  f.connection.set('disconnected')
  await f.tick(3000)
  assert.equal(f.reads(), 1)
  f.connection.set('connected')
  await drain()
  assert.equal(f.reads(), 2)
  // Real reconnect/Agent addition leaves lastAgentError and running unchanged.
  // Preparation emits availability after three seconds, not an activation edge.
  for (let elapsed = 250; elapsed <= 3000; elapsed += 250) {
    if (elapsed === 3000) {
      f.ready()
      f.emit('api-session/added', { sessionId: 'session', agentAvailable: true })
    }
    await f.tick(250)
  }
  assert.equal(f.session.getSnapshot().lastAgentError, '以前の準備に失敗しました')
  assert.deepEqual(f.live(), { id: 'goal', revision: 1, activation: 'disarmed' })
})

test('B2 タイマーを予約せず、画面終了で全購読を解放し終了後は読み直さない', async t => {
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
  assert.equal(scheduled.size, 0)
  assert.equal(f.connection.count(), 1)
  assert.equal(f.session.count(), 1)
  assert.equal(f.projection.count(), 1)
  assert.equal(f.events.size, 3)
  f.watcher.dispose()
  // No timer may survive or be created by teardown. Inspect before advancing
  // time, since the disposed RPC guard could otherwise hide a stray timeout.
  assert.equal(scheduled.size, 0)
  assert.equal(f.connection.count(), 0)
  assert.equal(f.session.count(), 0)
  assert.equal(f.projection.count(), 0)
  assert.equal(f.events.size, 0)
  f.connection.set('disconnected')
  f.connection.set('connected')
  f.session.set({ ...f.session.getSnapshot(), running: true })
  f.emit('api-session/added', { sessionId: 'session', agentAvailable: true })
  f.projection.set({ goal: { id: 'goal', revision: 2 } })
  await f.tick(3000)
  assert.equal(f.reads(), 1)
})

test('B2 100回再接続しても各接続で1回だけ読み、購読を増やさない', async t => {
  const f = fixture(t)
  await f.watcher.refresh()
  for (let i = 1; i <= 100; i++) {
    f.connection.set('disconnected')
    await f.tick(1000)
    assert.equal(f.reads(), i)
    f.connection.set('connected')
    await drain()
    assert.equal(f.reads(), i + 1)
    assert.equal(f.events.size, 3)
    assert.equal(f.connection.count(), 1)
    assert.equal(f.session.count(), 1)
    assert.equal(f.projection.count(), 1)
  }
})

for (const edge of ['projection', 'running'] as const) test(`B2 ${edge}の変化でタイマーを待たず読み直す`, async t => {
  const f = fixture(t)
  await f.watcher.refresh()
  f.ready()
  if (edge === 'projection') f.projection.set({ goal: { id: 'goal', revision: 1 }, roundsStarted: 1 })
  else f.session.set({ ...f.session.getSnapshot(), running: true })
  await drain()
  assert.equal(f.reads(), 2)
  assert.equal(f.live()?.id, 'goal')
})

test('B2 別会話の準備・失敗通知は無視し、Agent破棄では古い応答を捨てる', async t => {
  const f = fixture(t)
  let finish!: (value: unknown) => void
  f.pending(() => new Promise(resolve => { finish = resolve }))
  const reading = f.watcher.refresh()
  f.emit('api-session/added', { sessionId: 'another', agentAvailable: true })
  f.emit('api-session/error', 'another', '準備に失敗しました')
  assert.equal(f.reads(), 1)
  assert.equal(f.failures(), 0)
  f.emit('api-session/added', { sessionId: 'session', agentAvailable: false })
  assert.equal(f.failures(), 1)
  finish({ ok: true, value: { id: 'stale', revision: 1, activation: 'armed' } })
  await reading
  assert.equal(f.live(), undefined)
})

for (const edge of ['added', 'projection'] as const) test(`B2 ${edge}通知100件を直列の再取得にまとめ、最後の通知を取りこぼさない`, async t => {
  const f = fixture(t)
  let revision = 0, active = 0, peak = 0
  const requests: { revision: number; finish: () => void }[] = []
  f.pending(async () => {
    const observed = revision
    active++; peak = Math.max(peak, active)
    try {
      await new Promise<void>(resolve => { requests.push({ revision: observed, finish: resolve }) })
      return { ok: true, value: { id: 'goal', revision: observed, activation: 'disarmed' } }
    } finally { active-- }
  })
  const notify = () => {
    revision++
    if (edge === 'added') f.emit('api-session/added', { sessionId: 'session', agentAvailable: true })
    else f.projection.set({ goal: { id: 'goal', revision } })
  }
  for (let i = 0; i < 100; i++) notify()
  assert.equal(peak, 1, '進行中の読み取りを重ねない')
  assert.equal(f.reads(), 1)
  requests[0]!.finish(); await drain()
  assert.equal(f.reads(), 2, '100件の通知の末尾を1回だけ読み直す')
  assert.deepEqual(requests.map(request => request.revision), [1, 100])
  assert.equal(f.publications.length, 0, '通知より古い応答を公開しない')
  // A new edge during the trailing read must itself get a trailing read.
  notify()
  assert.equal(f.reads(), 2)
  requests[1]!.finish(); await drain()
  assert.equal(f.reads(), 3)
  assert.deepEqual(requests.map(request => request.revision), [1, 100, 101])
  assert.equal(f.publications.length, 0)
  requests[2]!.finish(); await drain()
  assert.deepEqual(f.publications, [{ id: 'goal', revision: 101, activation: 'disarmed' }])
  assert.equal(peak, 1)
  assert.equal(active, 0)
  await f.tick(3600000)
  assert.equal(f.reads(), 3, '通知が止まれば読み取りも止まる')
})

for (const stop of ['dispose', 'disconnect', 'remove', 'error', 'unavailable'] as const) test(`B2 ${stop}で進行中と待ちの読取りを無効にする`, async t => {
  const f = fixture(t)
  let finish!: (value: unknown) => void
  const response = new Promise(resolve => { finish = resolve })
  f.pending(() => response)
  const reading = f.watcher.refresh()
  for (let i = 0; i < 100; i++) f.projection.set({ goal: { id: 'goal', revision: i + 1 } })
  assert.equal(f.reads(), 1)
  if (stop === 'dispose') f.watcher.dispose()
  else if (stop === 'disconnect') f.connection.set('disconnected')
  else if (stop === 'remove') f.session.set({ ...f.session.getSnapshot(), removed: true })
  else if (stop === 'error') f.emit('api-session/error', 'session', '準備に失敗しました')
  else f.emit('api-session/added', { sessionId: 'session', agentAvailable: false })
  const failures = f.failures()
  finish({ ok: true, value: { id: 'stale', revision: 1, activation: 'armed' } })
  await reading
  await drain()
  assert.equal(f.publications.length, 0)
  assert.equal(f.failures(), failures, '古い応答から失敗も再通知しない')
  assert.equal(f.reads(), 1, '停止前にたまった読み直しを実行しない')
  if (stop === 'dispose') {
    assert.equal(f.events.size, 0)
    assert.equal(f.connection.count() + f.session.count() + f.projection.count(), 0)
  }
})

for (const failure of ['ok:false', '例外'] as const) test(`B2 読取りが${failure}で失敗しても、待ちの1回で最新状態を公開する`, async t => {
  const f = fixture(t)
  let resolve!: (value: unknown) => void, reject!: (reason: Error) => void
  const first = new Promise((done, fail) => { resolve = done; reject = fail })
  let revision = 1, active = 0, peak = 0
  const observed: number[] = []
  f.pending(async () => {
    observed.push(revision)
    active++; peak = Math.max(peak, active)
    try {
      if (observed.length === 1) return await first
      return { ok: true, value: { id: 'goal', revision, activation: 'disarmed' } }
    } finally { active-- }
  })
  const reading = f.watcher.refresh()
  for (let next = 2; next <= 101; next++) {
    revision = next
    f.projection.set({ goal: { id: 'goal', revision } })
  }
  assert.equal(f.reads(), 1)
  assert.equal(peak, 1)
  assert.deepEqual(f.publications, [])
  if (failure === '例外') reject(new Error('読取りに失敗しました'))
  else resolve({ ok: false, error: { code: 'gateway/unavailable', message: '読取りに失敗しました', details: {} } })
  // Do not send another edge or call refresh after failure: the queued edge
  // alone must start the trailing read.
  await reading
  assert.equal(f.reads(), 2, '失敗前にたまった通知の末尾を1回だけ取得する')
  assert.deepEqual(observed, [1, 101])
  assert.deepEqual(f.publications, [{ id: 'goal', revision: 101, activation: 'disarmed' }])
  assert.equal(f.failures(), 0, '新しい通知より古い失敗を公開しない')
  assert.equal(peak, 1)
  assert.equal(active, 0)
  await f.tick(3600000)
  assert.equal(f.reads(), 2, '末尾の取得が終われば追加の読取りをしない')
})
