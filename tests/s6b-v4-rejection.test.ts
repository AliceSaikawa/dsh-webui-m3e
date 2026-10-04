import assert from 'node:assert/strict'
import test from 'node:test'
import { invalidFixtureCases } from './helpers/s6b-invalid-fixtures.ts'
import { validateFixtureV4 } from './helpers/s6b-v4.ts'
import type { SessionWireEvent } from '../web/src/dsh/services.ts'

const cases = invalidFixtureCases()
assert.equal(cases.length, 30)
for (const { id, records, reason } of cases) test(`S6B native V4拒否: ${id}`, () => {
  assert.throws(() => validateFixtureV4(records, true), reason)
})

test('S6B 未知のuser/developer producerと拡張JSONをnativeどおり受け入れる', () => {
  const records: SessionWireEvent[] = [
    { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } },
    { type: 'step/start', seq: 1, time: 0, data: { turn: 1, step: 1 } },
    { type: 'developer/message', seq: 2, time: 0, surfaceOp: 'append', data: { turn: 1, step: 1,
      message: { id: 'developer', role: 'developer', source: { kind: 'unknown-producer', own: { type: 'tool-result' } }, content: [{ type: 'tool-removal', toolName: 'read_file' }] } } },
    { type: 'user/message', seq: 3, time: 0, surfaceOp: 'append', data: { id: 'user', role: 'user', source: { kind: 'another-producer' }, content: [{ type: 'plugin:block', metadata: { type: 'tool-result' } }] } },
    { type: 'step/end', seq: 4, time: 0, data: { turn: 1, step: 1 } },
    { type: 'turn/end', seq: 5, time: 0, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  assert.doesNotThrow(() => validateFixtureV4(records))
})
