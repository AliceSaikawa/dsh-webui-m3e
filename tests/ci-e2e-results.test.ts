import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { evaluateE2eReport } from '../scripts/ci-e2e-results.ts'

// The shape Playwright 1.63 writes with the json reporter, trimmed to the fields the guard reads.
type Outcome = 'expected' | 'unexpected' | 'flaky' | 'skipped'
const entry = (status: Outcome, expectedStatus = status === 'skipped' ? 'skipped' : 'passed') => ({ status, expectedStatus, results: [] })
function report(outcomes: Outcome[], extra: Record<string, unknown> = {}) {
  const stats = { startTime: '2026-10-10T00:00:00.000Z', duration: 1, expected: 0, unexpected: 0, flaky: 0, skipped: 0 }
  for (const outcome of outcomes) stats[outcome]++
  // Nest the tests the way describe blocks do: file suite → describe suite → specs.
  const specs = outcomes.map((outcome, index) => ({ title: `t${index}`, tests: [entry(outcome)] }))
  return { config: {}, suites: [{ title: 'a.spec.ts', specs: specs.slice(0, 1), suites: [{ title: 'describe', specs: specs.slice(1) }] }], errors: [], stats, ...extra }
}
const evaluate = (value: unknown, status = 0) => evaluateE2eReport(typeof value === 'string' ? value : JSON.stringify(value), status)

test('e2e guard accepts a complete report where every test ran as expected, including test.fail()', () => {
  const value = report(['expected', 'expected', 'expected'])
  value.suites[0]!.specs[0]!.tests[0]!.expectedStatus = 'failed'
  assert.deepEqual(evaluate(value), { exitCode: 0, counts: { tests: 3, expected: 3, unexpected: 0, flaky: 0, skipped: 0 } })
})

test('e2e guard rejects even one skipped browser test, although Playwright exits 0', () => {
  const result = evaluate(report(['expected', 'skipped']))
  assert.equal(result.exitCode, 1)
  assert.match(result.error ?? '', /Skipped browser tests are forbidden: 1/)
})

test('e2e guard rejects failed and flaky browser tests', () => {
  assert.match(evaluate(report(['expected', 'unexpected']), 1).error ?? '', /failed or were flaky/)
  assert.match(evaluate(report(['expected', 'flaky'])).error ?? '', /failed or were flaky/)
  assert.equal(evaluate(report(['expected', 'flaky'])).exitCode, 1)
})

test('e2e guard rejects a run where no browser test ran, such as an empty shard', () => {
  assert.match(evaluate(report([])).error ?? '', /No browser tests ran/)
  assert.match(evaluate(report(['skipped'])).error ?? '', /No browser tests ran/)
  const noTests = report([], { errors: [{ message: 'Error: No tests found' }] })
  assert.equal(evaluate(noTests, 1).exitCode, 1)
})

test('e2e guard rejects stats that disagree with the listed tests and unknown outcomes', () => {
  const hidden = report(['expected', 'expected'])
  hidden.stats.skipped = 1
  assert.match(evaluate(hidden).error ?? '', /do not match the listed tests/)
  const dropped = report(['expected', 'skipped'])
  dropped.suites[0]!.suites[0]!.specs = []
  assert.match(evaluate(dropped).error ?? '', /do not match the listed tests/)
  const unknown = report(['expected']) as { suites: { specs: { tests: { status: string }[] }[] }[] }
  unknown.suites[0]!.specs[0]!.tests[0]!.status = 'passed'
  assert.match(evaluate(unknown).error ?? '', /Unknown browser test outcome: passed/)
})

test('e2e guard rejects errors outside tests, such as a failed web server or global setup', () => {
  const value = report(['expected'], { errors: [{ message: 'Error: Timed out waiting 30000ms from config.webServer.' }] })
  assert.match(evaluate(value).error ?? '', /reported 1 error\(s\) outside tests/)
  const { errors: _errors, ...missing } = report(['expected'])
  assert.match(evaluate(missing).error ?? '', /Missing Playwright errors/)
})

test('e2e guard rejects missing, malformed, duplicate and non-object reports and invalid counts', () => {
  for (const value of ['', '{', 'null', '[]', '"report"', JSON.stringify(report(['expected'])) + JSON.stringify(report(['expected']))]) {
    assert.equal(evaluate(value).exitCode, 1, value.slice(0, 20))
  }
  assert.match(evaluate({ suites: [], errors: [] }).error ?? '', /Missing Playwright stats/)
  assert.match(evaluate({ ...report(['expected']), suites: undefined }).error ?? '', /Missing Playwright suites/)
  for (const bad of [-1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1, undefined]) {
    const value = report(['expected']) as { stats: Record<string, unknown> }
    value.stats.skipped = bad
    assert.match(evaluate(value).error ?? '', /Invalid browser test count: skipped/, String(bad))
  }
})

test('e2e guard preserves the original Playwright failure and rejects an invalid status', () => {
  assert.equal(evaluate('', 137).exitCode, 137)
  assert.equal(evaluate(report(['expected']), 1).exitCode, 1)
  assert.match(evaluate(report(['expected']), 1).error ?? '', /Playwright exited with status 1/)
  for (const status of [NaN, -1, 256, 1.5]) assert.equal(evaluate(report(['expected']), status).exitCode, 1)
})

test('e2e guard CLI fails for a skipped test or a missing report and preserves the runner exit code', t => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-e2e-results-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const run = (path: string, status: string) => spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/check-ci-e2e-results.ts', path, status], { encoding: 'utf8' })
  const ok = join(dir, 'ok.json')
  writeFileSync(ok, JSON.stringify(report(['expected'])))
  assert.equal(run(ok, '0').status, 0)
  const skipped = join(dir, 'skipped.json')
  writeFileSync(skipped, JSON.stringify(report(['expected', 'skipped'])))
  const result = run(skipped, '0')
  assert.equal(result.status, 1)
  assert.match(result.stdout, /Skipped browser tests are forbidden/)
  assert.equal(run(join(dir, 'missing.json'), '137').status, 137)
  assert.equal(run(join(dir, 'missing.json'), '0').status, 1)
  assert.equal(run(ok, 'x').status, 1)
})
