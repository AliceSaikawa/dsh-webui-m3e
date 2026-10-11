import { readFileSync } from 'node:fs'
import { evaluateTestReport } from './ci-test-results.ts'

const [path, status] = process.argv.slice(2)
const runnerStatus = status !== undefined && /^(0|[1-9]\d{0,2})$/.test(status) ? Number(status) : NaN
let report = ''
try {
  if (!path) throw new Error('Missing test summary path')
  report = readFileSync(path, 'utf8')
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
}
const result = evaluateTestReport(report, runnerStatus)
console.log(JSON.stringify({ runnerStatus, ...result }))
process.exitCode = result.exitCode
