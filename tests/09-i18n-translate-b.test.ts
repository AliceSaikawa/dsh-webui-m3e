import assert from 'node:assert/strict'
import test from 'node:test'
import { messagesOf, untranslatedLocales } from '../web/src/i18n/catalog.ts'
import { sessionToolsMessages } from '../web/src/features/session-tools/messages.ts'
import { formatTokens } from '../web/src/features/session-tools/presentation.ts'
import { fileSize } from '../web/src/features/session-tools/files.ts'
import { goalPhaseLabel, jobKindLabel, jobStatusLabel } from '../web/src/features/session-tools/operations.ts'
import { traceMessages } from '../web/src/features/trace/messages.ts'
import { formatDuration, formatJson, terminationLabel } from '../web/src/features/trace/model.ts'
import { recordUsageText } from '../web/src/features/trace/record-summary.ts'
import { traceEmptyMessage } from '../web/src/features/trace/view-state.ts'

const sessionEn = messagesOf(sessionToolsMessages, 'en')
const sessionZh = messagesOf(sessionToolsMessages, 'zh')
const traceEn = messagesOf(traceMessages, 'en')
const traceZh = messagesOf(traceMessages, 'zh')

test('session tools and trace catalogs have no untranslated language', () => {
  assert.deepEqual(untranslatedLocales(sessionToolsMessages), [])
  assert.deepEqual(untranslatedLocales(traceMessages), [])
})

test('session-tools numbers and units follow the page language', () => {
  assert.equal(formatTokens(12480, 'en', sessionEn), '12,480')
  assert.equal(formatTokens(12480, 'zh', sessionZh), '1.2万')
  assert.equal(formatTokens(12480, 'ja', sessionToolsMessages.ja), '1.2 万')
  assert.equal(formatTokens(undefined, 'en', sessionEn), 'Not available')

  assert.equal(fileSize(1, 'en', sessionEn), '1 byte')
  assert.equal(fileSize(1024, 'en', sessionEn), '1 KB')
  assert.equal(fileSize(1536, 'zh', sessionZh), '1.5 KB')
  assert.equal(fileSize(512, 'zh', sessionZh), '512 字节')
  assert.equal(fileSize(undefined, 'en', sessionEn), 'Size unknown')
})

test('session-tools labels are translated', () => {
  assert.equal(jobKindLabel('bash', sessionEn), 'Shell (bash)')
  assert.equal(jobKindLabel('bash', sessionZh), 'Shell（bash）')
  assert.equal(jobStatusLabel('killed', sessionEn), 'Stopped')
  assert.equal(jobStatusLabel('failed', sessionZh), '已失败')
  assert.equal(goalPhaseLabel('paused', undefined, sessionZh), '已暂停')
  assert.equal(sessionEn.durationMinutesSeconds(2, 5), '2m 5s')
  assert.equal(sessionZh.durationMinutesSeconds(2, 5), '2分5秒')
  assert.equal(sessionEn.goalStatusLine(sessionEn.goalPhaseRunning, 1, 4), 'Ongoing · Round 1 of 4')
  assert.equal(sessionZh.goalStatusLine(sessionZh.goalPhaseRunning, 1, 4), '进行中 · 第 1 / 4 轮')
})

test('trace units, rows and JSON marks follow the page language', () => {
  assert.equal(traceEmptyMessage('open', traceEn), 'No records yet.')
  assert.equal(formatDuration(4100, traceEn, 'en'), '4.1 s')
  assert.equal(formatDuration(4100, traceZh, 'zh'), '4.1 秒')
  assert.equal(formatDuration(65000, traceEn, 'en'), '1m 5s')
  assert.equal(terminationLabel({ kind: 'aborted', message: '' }, traceZh), '已中断')
  assert.equal(recordUsageText({ inputTokens: 11668, outputTokens: 812, cacheReadTokens: 9200 }, traceEn, 'en'),
    'Input 11,668 (excluding cache) · Output 812 · Cache read 9,200 · Cache write Not recorded')
  assert.equal(traceEn.searchSummary(2, 0), '2 matching records in the records loaded so far')
  assert.equal(traceEn.searchSummary(1, 1),
    '1 matching record in the records loaded so far. 1 other large record was only partly searched')

  const cycle: Record<string, unknown> = {}
  cycle.self = cycle
  // The English marks use the same 〔〕 as Japanese and Chinese, so they cannot be read as a JSON array.
  assert.equal(formatJson(cycle, traceEn, 'en').text, '{\n  "self": 〔Omitted: circular reference〕\n}')
  assert.equal(formatJson(cycle, traceZh, 'zh').text, '{\n  "self": 〔因循环引用而省略〕\n}')
})

test('trace and session-tools texts keep the meaning of the Japanese', () => {
  assert.equal(traceEn.outputTokens('1'), '1 output token')
  assert.equal(traceEn.outputTokens('812'), '812 output tokens')
  assert.equal(traceEn.imageInfo('a.png', 2, 3, '1'), 'a.png (2 × 3, 1 byte)')
  assert.equal(traceEn.imageInfo('a.png', 2, 3, '2,048'), 'a.png (2 × 3, 2,048 bytes)')
  assert.equal(traceEn.fileInfo('a.txt', '1'), 'Attached file: a.txt (1 byte)')
  assert.equal(traceEn.fileInfo('a.txt', '10'), 'Attached file: a.txt (10 bytes)')
  assert.equal(sessionEn.listUnavailable, 'The file list is not available.')
  assert.equal(sessionEn.jobKindOther, 'Job')
  assert.equal(sessionZh.jobKindOther, '任务')
  assert.equal(sessionZh.jobStatusKilled, '已停止')
})
