import assert from 'node:assert/strict'
import test from 'node:test'
import { catalogProblems, untranslatedLocales } from '../web/src/i18n/catalog.ts'
import { sessionToolsMessages, type SessionToolsText } from '../web/src/features/session-tools/messages.ts'
import { jobDurationLabel, jobKindLabel, jobStatusLabel, goalPhaseLabel } from '../web/src/features/session-tools/operations.ts'
import type { SessionJob } from '../web/src/dsh/services.ts'

const job = (id: string, status: SessionJob['status'], startedAt: number, finishedAt?: number): SessionJob =>
  ({ id, kind: 'bash', label: id, status, startedAt, finishedAt, output: { total: 0, earliest: 0 } }) as SessionJob

test('session-tools の辞書のキーはそろい、訳は未着手（null）のまま', () => {
  assert.deepEqual(catalogProblems(sessionToolsMessages), [])
  assert.deepEqual(untranslatedLocales(sessionToolsMessages), ['en', 'zh'])
})

test('移行待ち・外部タスク・移行が必要の文言が辞書に入っている', () => {
  const text = sessionToolsMessages.ja
  assert.equal(text.subagentsMigrationRequired, 'この会話の記録は古い形式のため、開き直して移行する必要があります。')
  assert.equal(text.externalTask, '外部タスク')
  assert.equal(text.childMigrationRequired, '移行が必要')
  assert.equal(text.childStateLine(text.childRunning, text.retryableChild), '実行中 ・ 続けて頼める')
  assert.equal(text.childStateLine(text.childMigrationRequired, text.oneShotChild), '移行が必要 ・ 1 回限り')
})

test('ジョブ・ゴール・統計の関数は渡した辞書の文言で組み立てる', () => {
  /** Modified catalog to prove each label comes from the argument, not the default. */
  const text: SessionToolsText = {
    ...sessionToolsMessages.ja,
    jobKindBash: 'B', jobKindPwsh: 'P', jobKindWorkflow: 'W', jobKindPtySend: 'T', jobKindOther: 'OTHER',
    durationSeconds: seconds => `${seconds}s`, goalPhasePaused: 'PAUSED', jobStatusRunning: 'RUN',
  }
  assert.equal(jobKindLabel('bash', text), 'B')
  assert.equal(jobKindLabel('pwsh', text), 'P')
  assert.equal(jobKindLabel('workflow', text), 'W')
  assert.equal(jobKindLabel('pty-send', text), 'T')
  assert.equal(jobKindLabel('unknown', text), 'OTHER')
  assert.equal(jobDurationLabel(job('a', 'running', 1000), 4000, text), '3s')
  assert.equal(goalPhaseLabel('paused', undefined, text), 'PAUSED')
  assert.equal(jobStatusLabel('running', text), 'RUN')
})
