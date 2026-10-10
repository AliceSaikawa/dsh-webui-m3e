import assert from 'node:assert/strict'
import test from 'node:test'
import { matchesError, reviewConsoleErrors } from '../e2e/browser-errors.ts'

const flags = ['', 'g', 'y', 'gy', 'i']

test('expectedErrors: a declared error that occurred once is allowed and counted as occurred, for every flag', () => {
  for (const flag of flags) {
    const pattern = new RegExp('synthetic', flag)
    assert.deepEqual(reviewConsoleErrors(['synthetic'], [pattern]), { unexpected: [], missing: [] }, `/synthetic/${flag}`)
  }
})

test('expectedErrors: the same error logged several times is allowed every time, for every flag', () => {
  for (const flag of flags) {
    const pattern = new RegExp('synthetic', flag)
    const errors = ['synthetic', 'synthetic', 'synthetic failure']
    assert.deepEqual(reviewConsoleErrors(errors, [pattern]), { unexpected: [], missing: [] }, `/synthetic/${flag}`)
  }
})

test('expectedErrors: reusing one declaration across tests gives the same result and leaves lastIndex alone', () => {
  for (const flag of flags) {
    const pattern = new RegExp('synthetic', flag)
    pattern.lastIndex = 5
    for (let run = 0; run < 3; run++) {
      assert.deepEqual(reviewConsoleErrors(['synthetic'], [pattern]), { unexpected: [], missing: [] }, `/synthetic/${flag} run ${run}`)
      assert.deepEqual(reviewConsoleErrors([], [pattern]), { unexpected: [], missing: [pattern] }, `/synthetic/${flag} run ${run}`)
    }
    assert.equal(pattern.lastIndex, 5, `/synthetic/${flag}`)
  }
})

test('expectedErrors: undeclared errors stay unexpected in order, and declarations that never matched are missing', () => {
  const declared = /synthetic/g
  const unused = /never logged/
  assert.deepEqual(reviewConsoleErrors(['other 1', 'synthetic', 'other 2'], [declared, unused]), {
    unexpected: ['other 1', 'other 2'],
    missing: [unused],
  })
  assert.deepEqual(reviewConsoleErrors(['anything'], []), { unexpected: ['anything'], missing: [] })
  assert.deepEqual(reviewConsoleErrors([], []), { unexpected: [], missing: [] })
})

test('expectedErrors: /y keeps matching only at the start of the message', () => {
  assert.equal(matchesError(/synthetic/y, 'synthetic failure'), true)
  assert.equal(matchesError(/synthetic/y, 'a synthetic failure'), false)
  assert.equal(matchesError(/synthetic/, 'a synthetic failure'), true)
})
