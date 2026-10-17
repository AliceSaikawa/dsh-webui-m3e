import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  diagnosticsEnabled, diagnosticsRequest, formatDiagnostics, frameStats, keyboardEstimate, pushEvent,
  type DiagnosticsSnapshot,
} from '../web/src/app/diagnostics.ts'
import { diagnosticsMessages } from '../web/src/app/messages.ts'

test('?diag で計測を始め、?diag=0 で止める。指定がなければ覚えた選択に従う', () => {
  assert.equal(diagnosticsRequest(''), undefined)
  assert.equal(diagnosticsRequest('?mock'), undefined)
  assert.equal(diagnosticsRequest('?diag'), 'on')
  assert.equal(diagnosticsRequest('?mock&diag=1'), 'on')
  assert.equal(diagnosticsRequest('?diag=0'), 'off')
  assert.equal(diagnosticsRequest('?diag=off'), 'off')

  assert.equal(diagnosticsEnabled('', null), false)
  assert.equal(diagnosticsEnabled('', '1'), true)
  assert.equal(diagnosticsEnabled('?diag', null), true)
  assert.equal(diagnosticsEnabled('?diag=0', '1'), false)
  assert.equal(diagnosticsEnabled('', 'yes'), false)
})

test('描画の回数と最大の間隔は直近 1 秒の requestAnimationFrame から求める', () => {
  assert.equal(frameStats([]), undefined)
  assert.equal(frameStats([5]), undefined)
  const at120 = Array.from({ length: 121 }, (_, index) => 1000 + index * (1000 / 120))
  const stats = frameStats(at120)!
  assert.ok(Math.abs(stats.fps - 120) < 0.01, String(stats.fps))
  assert.ok(Math.abs(stats.worst - 1000 / 120) < 0.01)
  // Frames older than 1 s before the newest drop out (0, 100); a long gap
  // inside the window shows as the worst interval.
  const stalled = [0, 100, 2000, 2016, 2116, 2132]
  assert.deepEqual(frameStats(stalled), { fps: 3 * 1000 / 132, worst: 100 })
})

test('出来事は新しいものから決まった件数だけ残す', () => {
  let log: string[] = []
  for (let index = 0; index < 13; index += 1) log = pushEvent(log, `e${index}`)
  assert.deepEqual(log, ['e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'e9', 'e10', 'e11', 'e12'])
  assert.deepEqual(pushEvent(['a'], 'b', 1), ['b'])
})

const snapshot: DiagnosticsSnapshot = {
  build: 'index-0123abcd.js',
  userAgent: 'Mozilla/5.0 (Android 15; Mobile; rv:140.0) Gecko/140.0 Firefox/140.0',
  displayMode: 'browser',
  orientation: 'portrait-primary',
  dpr: 3.5,
  screen: { width: 412, height: 904, availWidth: 412, availHeight: 904 },
  layout: { innerWidth: 412, innerHeight: 800, clientWidth: 412, clientHeight: 800 },
  visual: { width: 412, height: 480.5, offsetTop: 0, offsetLeft: 0, pageTop: 0, scale: 1 },
  units: { dvh: 800, svh: 744, lvh: 856 },
  safeArea: { top: 0, right: 0, bottom: 24, left: 0 },
  app: { top: 0, height: 480.5 },
  bottomBar: 480.5,
  focus: 'textarea',
  frames: { fps: 119.6, worst: 9.2 },
  events: ['+10ms visualViewport.resize 412×480 top 0'],
}

test('キーボードの推定は layout と visual の下端の差で、負にならない', () => {
  assert.equal(keyboardEstimate(snapshot), 319.5)
  assert.equal(keyboardEstimate({ ...snapshot, visual: { ...snapshot.visual!, height: 900 } }), 0)
  assert.equal(keyboardEstimate({ ...snapshot, visual: undefined }), undefined)
})

test('計測の文面に Issue #98 で確かめる値がすべて入る', () => {
  const text = formatDiagnostics(snapshot, diagnosticsMessages.ja)
  for (const part of [
    'M3E 計測  index-0123abcd.js',
    '画面 412×904 (avail 412×904)  DPR 3.50',
    '向き portrait-primary  表示 browser',
    'inner 412×800  client 412×800',
    'visual 412×480.5  offset 0,0  pageTop 0  scale 1.00',
    'dvh 800  svh 744  lvh 856',
    'safe-area 0 0 24 0 (top right bottom left)',
    'キーボード推定 319.5',
    'アプリの枠 上 0 高さ 480.5',
    '下端の部品の下端 480.5  visual の下端 480.5',
    'フォーカス textarea',
    '描画 120 fps  最大の間隔 9.2 ms',
    `UA ${snapshot.userAgent}`,
    '最近の出来事:\n+10ms visualViewport.resize 412×480 top 0',
  ]) assert.ok(text.includes(part), part)

  const empty = formatDiagnostics({ ...snapshot, visual: undefined, app: undefined, bottomBar: undefined, focus: undefined, frames: undefined, events: [] }, diagnosticsMessages.ja)
  for (const part of ['visual -', 'キーボード推定 -', 'アプリの枠 -', '下端の部品の下端 -  visual の下端 -', 'フォーカス なし', '描画 -']) {
    assert.ok(empty.includes(part), part)
  }
  assert.ok(!empty.includes('最近の出来事'))
})
