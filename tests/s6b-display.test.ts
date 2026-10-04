import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { captureDisplay } from './helpers/s6b-display.ts'

// Captured from `git show 722692c:web/src/...` (fixtures AND selectors), using
// captureDisplay and the fixed clock documented there. These are old values,
// not a snapshot blessed from the implementation being tested.
const baseline = JSON.parse(readFileSync(new URL('./fixtures/s6b-display-722692c.json', import.meta.url), 'utf8'))

function nativeExpected() {
  const expected = structuredClone(baseline)
  // Explicit, narrow exceptions to 722692c. Every one is required to replace an
  // invalid fixture with a native V4 history; none changes production rendering.
  // See s6b-v4-rules.md for the corresponding native requirements.
  const approval = expected['approval-sheet'].trace
  approval[0].number = 1; approval[0].heading = 'ターン 1 ・ 合計 18.4 秒 ・ 12,480 トークン'
  approval[1].number = 2; approval[1].heading = 'ターン 2 ・ 実行中'
  approval[0].rows[1].content.push({ type: 'tool-call', name: 'read_file', arguments: '{"path":"web/src/features/interactions/InteractionSheet.tsx"}' })
  // Native assistant/system messages require a step. Its start makes an
  // originally unmeasured assistant duration measurable, even at zero time.
  for (const id of ['chat-long', 'chat-long-streaming']) for (const turn of expected[id].trace.slice(0, 75)) turn.rows[1].durationMs = 0
  expected['chat-samples'].trace[0].rows[2].durationMs = 4000
  for (const id of ['session-tools-review', 'session-tools-tests']) expected[id].trace[0].rows[1].durationMs = 1000
  expected['chat-injected-context'].trace[0].rows.push({ kind: 'assistant', title: 'アシスタント', content: [], depth: 0,
    retries: 0, running: false, failed: false, durationMs: 5000 })
  // Previously the missing coordinates coalesced two accepted model calls,
  // hiding the read_file declaration. Each call now has its own numbered step.
  const spec = expected['chat-spec-check'].trace[0].rows
  spec[1].durationMs = 14000
  const bash = structuredClone(spec[2]); bash.durationMs = 0
  spec[2].content = [{ type: 'tool-call', name: 'read_file', arguments: '{"path":"README.md"}' }]
  spec[2].durationMs = 0
  spec[3].arguments = '{"path":"README.md"}'
  spec[4].arguments = '{"command":"pnpm test"}'
  spec.splice(4, 0, bash)
  // Consuming the initial model publishes lastUsed, as the native Host does.
  expected['chat-long-streaming'].home.icon = { kind: 'deepseek' }
  return expected
}

test('S6B 全fixture会話の一覧・chat・trace・モデル/深さ初期値を722692cと比較する', () => {
  const actual = captureDisplay(), expected = nativeExpected()
  assert.equal(Object.keys(expected).length, 53)
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), 'fixture coverage must not shrink')
  for (const id of Object.keys(expected)) for (const field of ['home', 'chat', 'trace', 'picker']) {
    assert.deepEqual(actual[id][field], expected[id][field], `${id}: ${field}`)
  }
})
