import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { countFields, evaluateTestReport } from '../scripts/ci-test-results.ts'
import summaryReporter from '../scripts/ci-summary-reporter.ts'

const valid = () => ({ success: true, duration_ms: 12,
  counts: { tests: 2, passed: 2, failed: 0, cancelled: 0, skipped: 0, todo: 0, suites: 0, topLevel: 2 } })

test('CI guard accepts only a complete all-passed zero-skip report', () => {
  const report = valid()
  assert.deepEqual(evaluateTestReport(JSON.stringify(report), 0), { exitCode: 0, counts: report.counts })
})

test('CI guard rejects even one skipped test', () => {
  const report = valid()
  report.counts.passed = 1
  report.counts.skipped = 1
  const result = evaluateTestReport(JSON.stringify(report), 0)
  assert.equal(result.exitCode, 1)
  assert.match(result.error!, /Skipped tests are forbidden: 1/)
  assert.equal(result.counts?.skipped, 1)
})

test('CI guard preserves original runner failure even for a missing or malformed report', () => {
  for (const report of ['', '{', JSON.stringify(valid())]) {
    for (const status of [1, 7, 137, 255]) assert.equal(evaluateTestReport(report, status).exitCode, status)
  }
})

test('CI guard rejects missing, malformed, duplicate and non-object reports', () => {
  for (const report of ['', '{', '{}', 'null', '[]', JSON.stringify(valid()) + JSON.stringify(valid())]) {
    assert.equal(evaluateTestReport(report, 0).exitCode, 1, report)
  }
})

test('CI guard rejects missing, negative, fractional, string or unsafe counts', () => {
  for (const field of countFields) {
    for (const value of [undefined, -1, 0.5, '0', null, Number.MAX_SAFE_INTEGER + 1]) {
      const report = valid()
      const counts: Record<string, unknown> = report.counts
      counts[field] = value
      assert.equal(evaluateTestReport(JSON.stringify(report), 0).exitCode, 1, `${field}: ${value}`)
    }
  }
})

test('CI guard rejects failed, cancelled, TODO and unsuccessful results', () => {
  for (const field of ['failed', 'cancelled', 'todo'] as const) {
    const report = valid()
    report.counts[field] = 1
    assert.equal(evaluateTestReport(JSON.stringify(report), 0).exitCode, 1)
  }
  assert.equal(evaluateTestReport(JSON.stringify({ ...valid(), success: false }), 0).exitCode, 1)
})

test('CI guard rejects empty or inconsistent totals and malformed summary metadata', () => {
  for (const counts of [{ tests: 0 }, { passed: 1 }, { topLevel: 0 }, { topLevel: 3 }]) {
    const report = valid()
    Object.assign(report.counts, counts)
    assert.equal(evaluateTestReport(JSON.stringify(report), 0).exitCode, 1)
  }
  for (const metadata of [{ success: undefined }, { success: 'true' }, { duration_ms: -1 },
    { duration_ms: '1' }, { duration_ms: null }, { file: 'individual.test.ts' }]) {
    assert.equal(evaluateTestReport(JSON.stringify({ ...valid(), ...metadata }), 0).exitCode, 1)
  }
})

test('CI guard rejects missing or invalid runner status', () => {
  for (const status of [NaN, Infinity, -1, 0.5, 256]) {
    assert.equal(evaluateTestReport(JSON.stringify(valid()), status).exitCode, 1)
  }
})

test('CI summary reporter ignores per-file summaries and emits only final structured counts', async () => {
  async function* events() {
    yield { type: 'test:stdout', data: { message: 'spoofed counts' } }
    yield { type: 'test:summary', data: { ...valid(), file: 'individual.test.ts' } }
    yield { type: 'test:summary', data: { ...valid() } }
  }
  let output = ''
  for await (const chunk of summaryReporter(events())) output += chunk
  assert.deepEqual(JSON.parse(output), valid())
  assert.equal(evaluateTestReport(output, 0).exitCode, 0)
})

test('CI summary reporter cannot pass without a cumulative summary', async () => {
  async function* events() { yield { type: 'test:summary', data: { ...valid(), file: 'individual.test.ts' } } }
  let output = ''
  for await (const chunk of summaryReporter(events())) output += chunk
  assert.equal(evaluateTestReport(output, 0).exitCode, 1)
})

test('CI CLI fails for a skipped test or missing report and preserves the runner exit code', () => {
  mkdirSync('tmp/ci', { recursive: true })
  const dir = mkdtempSync('tmp/ci/guard-')
  const path = join(dir, 'summary.json')
  const check = (file: string, status: string) => spawnSync(process.execPath,
    ['--experimental-strip-types', 'scripts/check-ci-test-results.ts', file, status], { encoding: 'utf8' })
  try {
    const report = valid()
    report.counts.passed = 1
    report.counts.skipped = 1
    writeFileSync(path, JSON.stringify(report))
    assert.equal(check(path, '0').status, 1)
    assert.equal(check(path, '7').status, 7)
    assert.equal(check(join(dir, 'missing.json'), '0').status, 1)
    assert.equal(check(join(dir, 'missing.json'), '13').status, 13)
    writeFileSync(path, '{')
    assert.equal(check(path, '0').status, 1)
    assert.equal(check(path, '23').status, 23)
    writeFileSync(path, JSON.stringify(valid()))
    assert.equal(check(path, '0').status, 0)
    assert.equal(check(path, '').status, 1)
    assert.equal(check(path, '256').status, 1)
  } finally { rmSync(dir, { recursive: true }) }
})
