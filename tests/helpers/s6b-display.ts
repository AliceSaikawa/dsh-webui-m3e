import { createMockContext } from '../../web/src/dsh/mock/context.ts'
import assert from 'node:assert/strict'
import { foldSessionWindow } from '../../web/src/dsh/session-journal.ts'
import * as chat from '../../web/src/features/chat/mock.ts'
import * as composer from '../../web/src/features/composer/mock.ts'
import * as home from '../../web/src/features/home/mock.ts'
import * as inbox from '../../web/src/features/inbox/mock.ts'
import * as interactions from '../../web/src/features/interactions/mock.ts'
import * as search from '../../web/src/features/search/mock.ts'
import * as sessionTools from '../../web/src/features/session-tools/mock.ts'
import * as trace from '../../web/src/features/trace/mock.ts'
import { buildChatRows } from '../../web/src/features/chat/model.ts'
import { selectTrace, turnHeading } from '../../web/src/features/trace/model.ts'
import { folderName, formatUpdatedAt, modelIcon } from '../../web/src/features/home/data.ts'
import { effortValue, modelChoices, modelValue, reasoningForSelection } from '../../web/src/features/composer/model-picker.ts'
import type { ModelSelectionProjection } from '../../web/src/features/composer/api.ts'

// Visual data only: identity/sequence and absolute event clocks are implementation
// details. Keep durations, row order, content, errors, model labels and effort.
function visible(value: unknown): any {
  if (Array.isArray(value)) return value.map(visible)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key, v]) => v !== undefined && ![
    'key', 'seq', 'time', 'id', 'callId', 'callKey', 'toolCallId', 'parentCallId', 'rootCallId', 'turn', 'step',
    'startedAt', 'completedAt', 'input', 'attachmentId',
  ].includes(key)).map(([key, v]) => [key, visible(v)]))
}

export async function captureDisplay() {
  const realNow = Date.now
  Date.now = () => Date.parse('2026-09-25T09:00:00+09:00')
  try {
  const result: Record<string, any> = {}
  const scenarios = [undefined, 'chat-injected-context', 'chat-error', 'open-error', 'chat-long-streaming', 'inbox', 'search-more', 'question-continued']
  for (const scenario of scenarios) {
    const ctx = createMockContext({ scenario, pageSize: 100_000, extensions: [chat, composer, home, inbox, interactions, search, sessionTools, trace] })
    try {
      for (const summary of Object.values(ctx.sessions.list.getSnapshot().byId)) {
        const reference = ctx.sessions.retain(summary.id, { source: 'm3e.display-test' })
        // A deliberately failed open has no visible journal. Keep its durable
        // fixture comparison too; all successful opens use the real journal.
        let journal = { records: ctx.mock.getRecords(summary.id), stream: null } as ReturnType<typeof foldSessionWindow>
        try { journal = foldSessionWindow((await reference.ready).eventSource.getSnapshot()) }
        catch { assert.equal(scenario, 'open-error') }
        finally { reference.release() }
        const { records, stream } = journal
        const selection = summary.projectionValues?.modelSelection as ModelSelectionProjection | undefined
        const initial = selection?.next ?? composer.mockModelCatalog.default
        const choices = modelChoices(composer.mockModelCatalog)
        const display = {
          home: { title: summary.displayTitle, folder: folderName(summary.cwd), date: formatUpdatedAt(summary.updatedAt, new Date('2026-10-01T00:00:00Z')),
            icon: modelIcon(selection?.lastUsed), running: summary.running, child: summary.origin === 'subagent' },
          chat: visible(buildChatRows(records, stream)),
          trace: selectTrace(records, stream, summary.running).map(turn => ({ heading: turnHeading(turn), ...visible(turn) })),
          live: stream ? { turn: stream.turn, step: stream.step, content: visible(stream.content) } : null,
          picker: { value: modelValue(initial), label: choices.find(choice => choice.value === modelValue(initial))?.label ?? '',
            effort: effortValue(initial, choices), reasoning: reasoningForSelection(initial, choices) ?? null },
        }
        // Deduplication must not silently discard a scenario's live state.
        if (result[summary.id]) assert.deepEqual(display, result[summary.id], `${scenario}/${summary.id} display differs`)
        else result[summary.id] = display
      }
    } finally { ctx.dispose() }
  }
    return result
  } finally { Date.now = realNow }
}
