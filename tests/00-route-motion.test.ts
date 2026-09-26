import assert from 'node:assert/strict'
import test from 'node:test'
import { routeMotion, startRouteMotion, type MotionFrame, type MotionTiming } from '../web/src/app/route-motion.ts'

test('下のタブはフェードし、奥への移動と履歴の戻りは逆向きになる', () => {
  assert.equal(routeMotion({ pathname: '/', index: 0 }, { pathname: '/inbox', index: 0 }), 'fade')
  assert.equal(routeMotion({ pathname: '/settings', index: 2 }, { pathname: '/search', index: 1 }), 'fade')
  assert.equal(routeMotion({ pathname: '/search', index: 0 }, { pathname: '/s/a', index: 1 }), 'forward')
  assert.equal(routeMotion({ pathname: '/s/a', index: 1 }, { pathname: '/search', index: 0 }), 'back')
  assert.equal(routeMotion({ pathname: '/s/a', index: 1 }, { pathname: '/s/a/files', index: 2 }), 'forward')
  assert.equal(routeMotion({ pathname: '/s/a/files', index: 2 }, { pathname: '/s/a', index: 1 }), 'back')
  assert.equal(routeMotion({ pathname: '/s/a', index: 1 }, { pathname: '/s/b', index: 2 }), 'forward')
})

test('チャットとトレース、初回表示、同じ画面の更新は動かさない', () => {
  for (const [from, to] of [['/s/a', '/s/a/trace'], ['/s/a/trace', '/s/a'], ['/s/a', '/s/a'], ['/search', '/search']]) {
    assert.equal(routeMotion({ pathname: from!, index: 1 }, { pathname: to!, index: 1 }), 'none')
  }
})

test('履歴のない直リンクから一覧へ戻る場合と親への置換も戻る向きになる', () => {
  assert.equal(routeMotion({ pathname: '/s/a', index: 0 }, { pathname: '/', index: 0 }), 'back')
  assert.equal(routeMotion({ pathname: '/settings/model', index: 0 }, { pathname: '/settings', index: 0 }), 'back')
  assert.equal(routeMotion({ pathname: '/new', index: 0 }, { pathname: '/s/new', index: 0 }), 'forward')
})

function motionFixture(reduced = false) {
  const listeners = new Set<() => void>()
  const calls: { frames: MotionFrame[]; options: MotionTiming }[] = []
  let cancellations = 0
  const preference = {
    matches: reduced,
    addEventListener(_type: 'change', listener: () => void) { listeners.add(listener) },
    removeEventListener(_type: 'change', listener: () => void) { listeners.delete(listener) },
  }
  const target = { animate(frames: MotionFrame[], options: MotionTiming) {
    calls.push({ frames, options })
    return { cancel() { cancellations++ } }
  } }
  return { target, preference, listeners, calls, cancellations: () => cancellations }
}

test('進むと右から、戻ると左から入り、タブでは横移動しない', () => {
  for (const motion of ['forward', 'back', 'fade'] as const) {
    const fixture = motionFixture()
    const stop = startRouteMotion(fixture.target, motion, fixture.preference)
    const call = fixture.calls[0]!
    assert.equal(fixture.calls.length, 1)
    if (motion === 'fade') assert.deepEqual(call.frames, [{ opacity: 0 }, { opacity: 1 }])
    else assert.deepEqual(call.frames, [{ transform: `translateX(${motion === 'back' ? '-100%' : '100%'})` }, { transform: 'translateX(0)' }])
    assert.ok(Number(call.options.duration) <= 250)
    stop()
    assert.equal(fixture.cancellations(), 1)
    assert.equal(fixture.listeners.size, 0)
  }
})

test('動きを減らす設定と非対応端末は即時表示し、途中の設定変更や離脱でも動きを残さない', () => {
  const reduced = motionFixture(true)
  startRouteMotion(reduced.target, 'forward', reduced.preference)()
  assert.equal(reduced.calls.length, 0)
  assert.equal(reduced.listeners.size, 0)
  startRouteMotion({}, 'back', reduced.preference)()
  const active = motionFixture()
  startRouteMotion(active.target, 'none', active.preference)()
  assert.equal(active.calls.length, 0)
  const stop = startRouteMotion(active.target, 'forward', active.preference)
  active.preference.matches = true
  active.listeners.forEach((listener) => listener())
  assert.equal(active.cancellations(), 1)
  stop()
  assert.equal(active.listeners.size, 0)
})
