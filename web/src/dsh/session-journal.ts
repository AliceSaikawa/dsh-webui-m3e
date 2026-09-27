import type {
  ContentBlock, FinishReason, ObservableSnapshot, SessionBinding, SessionEventLikeEntry,
  SessionEventWindow, SessionWireEvent, StreamChunk, TokenUsage,
} from './services.ts'

/** A live block folded by stream index; a block-end or finish completes it. */
export interface StreamBlock {
  readonly index: number
  readonly block: ContentBlock
  readonly complete: boolean
}

/** The controller restores the assistant baseline and validates nextIndex first. */
export interface AssistantStream {
  readonly attemptId: string
  readonly turn: number
  readonly step: number
  /** Raw chunks; the journal folds them into `blocks` and leaves this out. */
  readonly chunks?: readonly StreamChunk[]
  /** Folded blocks in index order, kept by identity while a block does not change. */
  readonly blocks?: readonly StreamBlock[]
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
 * block-end is authoritative and later deltas for that index are ignored;
 * stream indices are block indices, not append order.
 */
export function foldSessionWindow(window: SessionEventWindow): SessionJournal {
  return { records: readRecords(window), stream: streamOf(applyChunks(undefined, window.entries)) }
}

function readRecords(window: SessionEventWindow): readonly SessionWireEvent[] {
  return window.entries.flatMap(entry => entry.type === 'event' ? [entry.event] : [])
    .sort((a, b) => a.seq - b.seq)
}

/** Check the complete ordered window when the latest delta cannot cover a gap. */
function hasSameRecords(window: SessionEventWindow, records: readonly SessionWireEvent[]): boolean {
  let index = 0
  for (const entry of window.entries) {
    if (entry.type !== 'event') continue
    if (entry.event !== records[index]) return false
    index++
  }
  return index === records.length
}

/**
 * Mutable fold state for one attempt. Chunks are applied once each, so a long
 * response costs one step per chunk rather than a rescan of the whole window.
 */
interface StreamFold {
  attemptId: string
  turn: number
  step: number
  readonly blocks: Map<number, StreamBlock>
  usage?: TokenUsage
  finishReason?: FinishReason
}

function applyChunks(fold: StreamFold | undefined, entries: readonly SessionEventLikeEntry[]): StreamFold | undefined {
  for (const entry of entries) {
    if (entry.type === 'event') continue
    const { attemptId, turn, step, chunk } = entry.event.data
    if (fold?.attemptId !== attemptId) fold = { attemptId, turn, step, blocks: new Map() }
    applyChunk(fold, chunk)
  }
  return fold
}

function applyChunk(fold: StreamFold, chunk: StreamChunk): void {
  if (chunk.type === 'usage') { fold.usage = chunk.usage; return }
  if (chunk.type === 'finish') { fold.finishReason = chunk.reason; return }
  const { blocks } = fold
  if (chunk.type === 'block-end') {
    blocks.set(chunk.index, { index: chunk.index, block: chunk.block, complete: true })
    return
  }
  if (chunk.type === 'block-start') {
    if (chunk.blockType === 'text' || chunk.blockType === 'reasoning') {
      blocks.set(chunk.index, { index: chunk.index, block: { type: chunk.blockType, text: '' }, complete: false })
    }
    return
  }
  const previous = blocks.get(chunk.index)
  if (previous?.complete) return
  if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
    const type = chunk.type === 'text-delta' ? 'text' : 'reasoning'
    const prefix = previous?.block.type === type ? previous.block.text : ''
    blocks.set(chunk.index, { index: chunk.index, block: { type, text: prefix + chunk.text }, complete: false })
  } else {
    const call = previous?.block.type === 'tool-call' ? previous.block : undefined
    blocks.set(chunk.index, {
      index: chunk.index, complete: false,
      block: { type: 'tool-call', id: chunk.id, name: chunk.name ?? call?.name ?? '', arguments: (call?.arguments ?? '') + chunk.argumentsDelta },
    })
  }
}

/** Read folded blocks, folding raw chunks or the restored content when a stream has no blocks. */
export function streamBlocksOf(stream: AssistantStream): readonly StreamBlock[] {
  if (stream.blocks !== undefined) return stream.blocks
  if (stream.chunks === undefined || stream.chunks.length === 0) {
    return stream.content.map((block, index) => ({ index, block, complete: stream.finishReason !== undefined }))
  }
  const fold: StreamFold = { attemptId: stream.attemptId, turn: stream.turn, step: stream.step, blocks: new Map() }
  for (const chunk of stream.chunks) applyChunk(fold, chunk)
  if (stream.finishReason !== undefined) fold.finishReason ??= stream.finishReason
  return streamOf(fold)?.blocks ?? []
}

/** Blocks that did not change keep their identity, so settled rows can skip re-rendering. */
const completedBlocks = new WeakMap<StreamBlock, StreamBlock>()
function streamOf(fold: StreamFold | undefined): AssistantStream | null {
  if (fold === undefined) return null
  let blocks = [...fold.blocks.values()].sort((a, b) => a.index - b.index)
  if (fold.finishReason !== undefined) {
    blocks = blocks.map(value => {
      if (value.complete) return value
      let complete = completedBlocks.get(value)
      if (complete === undefined) completedBlocks.set(value, complete = { ...value, complete: true })
      return complete
    })
  }
  return {
    attemptId: fold.attemptId, turn: fold.turn, step: fold.step, blocks,
    content: blocks.map(value => value.block),
    ...(fold.usage === undefined ? {} : { usage: fold.usage }),
    ...(fold.finishReason === undefined ? {} : { finishReason: fold.finishReason }),
  }
}

/** One derived cache and one upstream subscription for all consumers of a binding. */
export function createSessionJournal(source: ObservableSnapshot<SessionEventWindow>): ObservableSnapshot<SessionJournal> {
  let lastWindow: SessionEventWindow | undefined
  let value = EMPTY_JOURNAL
  let fold: StreamFold | undefined
  const listeners = new Set<() => void>()
  let unsubscribe: (() => void) | undefined
  const getSnapshot = () => {
    const window = source.getSnapshot()
    if (window !== lastWindow) {
      // A change describes only the latest revision. If revisions were missed,
      // check every durable reference before reusing records; an earlier delta
      // may have added or replaced a durable event. First reads always rebuild.
      const transientAppend = lastWindow !== undefined
        && window.change.kind === 'append'
        && window.change.entries.every(entry => entry.type === 'transient')
      const nextRevision = lastWindow !== undefined && window.revision === lastWindow.revision + 1
      // Only the very next revision may extend the stream fold; a skipped
      // revision may have carried chunks this cache never saw.
      fold = transientAppend && nextRevision
        ? applyChunks(fold, window.change.entries)
        : applyChunks(undefined, window.entries)
      value = {
        records: transientAppend && (nextRevision || hasSameRecords(window, value.records)) ? value.records : readRecords(window),
        stream: streamOf(fold),
      }
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
