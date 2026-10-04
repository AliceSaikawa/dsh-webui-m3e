import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { MOCK_IDS } from '../web/src/dsh/mock/fixtures.ts'
import { onRemoteEvent } from '../web/src/dsh/remote-events.ts'

test('通常放送は追加引数を全購読者へ渡し、単一の配列 payload を展開しない', async () => {
  const ctx = createMockContext()
  try {
    const received: unknown[][] = []
    const on = ctx.remote.$on as (event: string, handler: (...args: unknown[]) => unknown) => () => void
    const off = on('settings/document-updated', (...args) => received.push(args))
    on('settings/document-updated', (...args) => received.push(args))
    await ctx.mock.emit('settings/document-updated', 'agent-loop', { additionalArgs: [7] })
    assert.deepEqual(received, [['agent-loop', 7], ['agent-loop', 7]])
    off()
    const payload = ['agent-loop', 8]
    await ctx.mock.emit('settings/document-updated', payload)
    assert.deepEqual(received.at(-1), [payload])
    assert.equal(received.length, 3)
  } finally { ctx.dispose() }
})

test('初期購読待ちと遅延放送でも namespace と revision の順序を保つ', async () => {
  let startup!: Promise<unknown>
  const ctx = createMockContext({ extensions: [{ extendMock(kit) {
    startup = kit.emit('settings/document-updated', 'agent-loop', { additionalArgs: [0] })
  } }] })
  try {
    const received: unknown[][] = []
    onRemoteEvent(ctx.remote, 'settings/document-updated', (ns, revision) => { received.push([ns, revision]) })
    await startup
    assert.deepEqual(received, [['agent-loop', 0]])
    const delayed = ctx.mock.emit('settings/document-updated', 'agent-loop', { additionalArgs: [1], afterMs: 0 })
    assert.equal(received.length, 1)
    await delayed
    assert.deepEqual(received, [['agent-loop', 0], ['agent-loop', 1]])
  } finally { ctx.dispose() }
})

test('既存の単一 payload・遅延オプション・承認 waterfall の next と回答を保つ', async () => {
  const ctx = createMockContext()
  try {
    const on = ctx.remote.$on as (event: string, handler: (this: unknown, payload: unknown, next: () => Promise<unknown>) => unknown) => () => void
    const received: unknown[] = []
    const payload = { agent: MOCK_IDS.sessions.readme }
    on('approval/request', async function (value, next) {
      received.push(value, ctx.sessions.scopeOf(this))
      return `first:${await next()}`
    })
    on('approval/request', () => 'allowed-once')
    const reply = ctx.mock.emit('approval/request', payload, { afterMs: 0 })
    assert.deepEqual(received, [])
    assert.equal(await reply, 'first:allowed-once')
    assert.deepEqual(received, [payload, MOCK_IDS.sessions.readme])
    assert.equal(ctx.sessions.retainInfo(MOCK_IDS.sessions.readme).getSnapshot().referenceCount, 0)
  } finally { ctx.dispose() }
})
