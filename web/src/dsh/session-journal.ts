import type {
  ContentBlock, FinishReason, ISessions, ObservableSnapshot, SessionBinding, SessionEventWindow,
  SessionWireEvent, StreamChunk, TokenUsage,
} from './services.ts'

/** The controller restores the assistant baseline and validates nextIndex first. */
export interface AssistantStream {
  readonly attemptId: string
  readonly turn: number
  readonly step: number
  readonly chunks: readonly StreamChunk[]
  readonly content: readonly ContentBlock[]
  readonly usage?: TokenUsage
  readonly finishReason?: FinishReason
}
export interface SessionJournal {
  readonly records: readonly SessionWireEvent[]
  readonly stream: AssistantStream | null
}

const EMPTY_JOURNAL: SessionJournal = { records: [], stream: null }
export const emptyJournalSource: ObservableSnapshot<SessionJournal> = {
  getSnapshot: () => EMPTY_JOURNAL,
  subscribe: () => () => {},
}

/**
 * Fold a complete controller window, so a reconnect replaces old transient text.
 * Durable entries keep every wire field and are returned in ascending seq order.
 * block-end is authoritative; stream indices are block indices, not append order.
 */
export function foldSessionWindow(window: SessionEventWindow): SessionJournal {
  const records: SessionWireEvent[] = []
  const blocks = new Map<number, ContentBlock>()
  let active: { attemptId: string; turn: number; step: number } | undefined
  let chunks: StreamChunk[] = []
  let usage: TokenUsage | undefined
  let finishReason: FinishReason | undefined
  for (const entry of window.entries) {
    if (entry.type === 'event') {
      records.push(entry.event)
      continue
    }
    const { attemptId, turn, step, chunk } = entry.event.data
    if (active?.attemptId !== attemptId) {
      active = { attemptId, turn, step }
      blocks.clear()
      chunks = []
      usage = undefined
      finishReason = undefined
    }
    chunks.push(chunk)
    switch (chunk.type) {
      case 'block-start':
        if (chunk.blockType === 'text' || chunk.blockType === 'reasoning') {
          blocks.set(chunk.index, { type: chunk.blockType, text: '' })
        }
        break
      case 'text-delta': {
        const previous = blocks.get(chunk.index)
        blocks.set(chunk.index, { type: 'text', text: (previous?.type === 'text' ? previous.text : '') + chunk.text })
        break
      }
      case 'reasoning-delta': {
        const previous = blocks.get(chunk.index)
        blocks.set(chunk.index, { type: 'reasoning', text: (previous?.type === 'reasoning' ? previous.text : '') + chunk.text })
        break
      }
      case 'tool-call-delta': {
        const previous = blocks.get(chunk.index)
        const tool = previous?.type === 'tool-call' ? previous : undefined
        blocks.set(chunk.index, {
          type: 'tool-call', id: chunk.id, name: chunk.name ?? tool?.name ?? '',
          arguments: (tool?.arguments ?? '') + chunk.argumentsDelta,
        })
        break
      }
      case 'block-end':
        blocks.set(chunk.index, chunk.block)
        break
      case 'usage':
        usage = chunk.usage
        break
      case 'finish':
        finishReason = chunk.reason
        break
    }
  }
  records.sort((a, b) => a.seq - b.seq)
  return {
    records,
    stream: active === undefined ? null : {
      ...active, chunks,
      content: [...blocks.entries()].sort(([a], [b]) => a - b).map(([, block]) => block),
      ...(usage === undefined ? {} : { usage }),
      ...(finishReason === undefined ? {} : { finishReason }),
    },
  }
}

/** One derived cache and one upstream subscription for all consumers of a binding. */
export function createSessionJournal(source: ObservableSnapshot<SessionEventWindow>): ObservableSnapshot<SessionJournal> {
  let lastWindow: SessionEventWindow | undefined
  let value = EMPTY_JOURNAL
  const listeners = new Set<() => void>()
  let unsubscribe: (() => void) | undefined
  const getSnapshot = () => {
    const window = source.getSnapshot()
    if (window !== lastWindow) {
      value = foldSessionWindow(window)
      lastWindow = window
    }
    return value
  }
  return {
    getSnapshot,
    subscribe(listener) {
      listeners.add(listener)
      if (unsubscribe === undefined) {
        unsubscribe = source.subscribe(() => {
          getSnapshot()
          for (const notify of [...listeners]) notify()
        })
      }
      let active = true
      return () => {
        if (!active) return
        active = false
        listeners.delete(listener)
        if (listeners.size === 0) {
          unsubscribe?.()
          unsubscribe = undefined
        }
      }
    },
  }
}

const journals = new WeakMap<ObservableSnapshot<SessionEventWindow>, ObservableSnapshot<SessionJournal>>()
export function journalOf(binding: SessionBinding | undefined): ObservableSnapshot<SessionJournal> {
  if (binding === undefined) return emptyJournalSource
  let journal = journals.get(binding.eventSource)
  if (journal === undefined) {
    journal = createSessionJournal(binding.eventSource)
    journals.set(binding.eventSource, journal)
  }
  return journal
}

/** Opening the selection is the controller's follow signal, never a second RPC. */
export function ensureSessionOpen(sessions: ISessions, binding: SessionBinding | undefined): void {
  if (binding === undefined) return
  const snapshot = binding.session.getSnapshot()
  if (sessions.list.getSnapshot().current !== binding.sessionId || snapshot.openState === 'cold' || snapshot.openState === 'error') {
    sessions.open(binding.sessionId)
  }
}
