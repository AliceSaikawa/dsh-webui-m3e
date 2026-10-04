import assert from 'node:assert/strict'
import { createMockContext } from '../../web/src/dsh/mock/context.ts'
import type { SessionWireEvent } from '../../web/src/dsh/services.ts'
import * as chat from '../../web/src/features/chat/mock.ts'
import * as composer from '../../web/src/features/composer/mock.ts'
import * as home from '../../web/src/features/home/mock.ts'
import * as inbox from '../../web/src/features/inbox/mock.ts'
import * as interactions from '../../web/src/features/interactions/mock.ts'
import * as search from '../../web/src/features/search/mock.ts'
import * as sessionTools from '../../web/src/features/session-tools/mock.ts'
import * as trace from '../../web/src/features/trace/mock.ts'
import { traceRetryCancelledRecords } from '../../web/src/features/trace/trace-fixtures.ts'
// Inspect whole Host histories, not the 100-record Client window. The deliberately
// broken parser inputs in older unit tests are not normal fixture histories.
export function histories() {
  const rows: { id: string; running: boolean; records: readonly SessionWireEvent[] }[] = []
  for (const scenario of [undefined, 'chat-injected-context', 'chat-error', 'open-error', 'chat-long-streaming', 'inbox', 'search-more', 'question-continued']) {
    const ctx = createMockContext({ scenario, extensions: [chat, composer, home, inbox, interactions, search, sessionTools, trace] })
    try {
      const baseIds = ['readme-review', 'approval-sheet', 'chat-long', 'chat-samples', 'chat-spec-check',
        'home-mobile-layout', 'home-workspace-question', 'home-review-child', 'home-list-menu', 'home-harness-tests',
        '05-db-choice', '05-auth-redesign', 'search-permissions', 'search-mobile', 'search-history', 'search-colors',
        'session-tools-review', 'session-tools-tests', 'trace-example', 'trace-failure-example']
      const extra = scenario === 'inbox' ? ['inbox-approval', 'inbox-question', 'inbox-plan', 'inbox-completed', 'inbox-other-completed']
        : scenario === 'search-more' ? Array.from({ length: 24 }, (_, i) => `search-example-${i + 1}`)
        : scenario === 'open-error' ? ['chat-open-error']
        : scenario?.startsWith('chat-') ? [scenario] : []
      assert.deepEqual(Object.keys(ctx.sessions.list.getSnapshot().byId).sort(), [...baseIds, ...extra].sort(), `${scenario ?? 'default'}: fixture initialization must not lose sessions`)
      for (const summary of Object.values(ctx.sessions.list.getSnapshot().byId)) rows.push({
        id: `${scenario ?? 'default'}/${summary.id}`, running: summary.running, records: ctx.mock.getRecords(summary.id),
      })
    } finally { ctx.dispose() }
  }
  rows.push({ id: 'cancelled-retry', running: false, records: traceRetryCancelledRecords })
  assert.equal(rows.length, 194)
  assert.deepEqual(rows.filter(row => row.records.length === 0).map(row => row.id), [
    'open-error/chat-open-error', 'inbox/inbox-approval', 'inbox/inbox-question', 'inbox/inbox-plan', 'inbox/inbox-completed', 'inbox/inbox-other-completed',
  ])
  return rows
}
