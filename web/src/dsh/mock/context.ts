import type {
  AgentContext, BeginSubmissionInput, ContentBlock, DshContext, ImageAttachmentRef,
  IWorkspaces, ISessions, JsonValue, PendingSubmissionRetirement, RemoteResult,
  SessionBinding, SessionEventChange, SessionEventLikeEntry, SessionEventWindow,
  SessionFace, SessionListState, SessionSnapshot, SessionSummary, SessionWireEvent,
  StreamChunk, WorkspaceSnapshot, WorkspaceView, SessionReference, SessionRetainInfo,
  SessionTarget, SessionJob, InboxState, RemoteFailure, SubagentAddress, SubagentCatalogEntry, ConnectionState,
} from '../services.ts'
import { normalizeMockTitle, referencesImage } from './session-validation.ts'
import { mockSearchMatch, validMockSearchQuery } from './search.ts'
import { admitMockImages, type MockImageLimits } from './images.ts'
import { mockForkSeed } from './fork.ts'
import { createMockQuestions, type MockTimedQuestion, type MockQuestionAnswer } from './questions.ts'
import { createMockJobs, type JobFrame } from './jobs.ts'
import { observable, lifecycle, type MutableSnapshot } from './observable.ts'
import { completionStatus } from '../completion-status.ts'
import { conversationSelection } from '../conversation-selection.ts'
import { imageAttachment, imageBase64, MOCK_IDS, sharedSessions, sharedWorkspaces } from './fixtures.ts'

type EventHandler = (this: AgentContext, ...args: unknown[]) => unknown
export interface MockEmitOptions {
  afterMs?: number
  /** Additional positional broadcast arguments, after payload. Never flatten payload arrays. */
  additionalArgs?: readonly unknown[]
}
export interface MockKit {
  addWorkspace(workspace: WorkspaceView): void
  /** Update an existing workspace in place; unknown ids throw and identity stays fixed. */
  updateWorkspace(workspaceId: string, update: Partial<Omit<WorkspaceView, 'workspaceId'>> | ((current: WorkspaceView) => Partial<Omit<WorkspaceView, 'workspaceId'>>)): void
  addSession(summary: Omit<SessionSummary, 'retainedBy'> & Partial<Pick<SessionSummary, 'retainedBy'>>, records: readonly SessionWireEvent[], options?: { agentAvailable?: boolean }): void
  /** Agent disposal does not delete the persisted conversation. */
  setAgentAvailable(sessionId: string, available: boolean): void
  setConnectionState(state: ConnectionState): void
  /** Timed question notification, business wait stream, and durable projection. */
  emitTimedQuestion(sessionId: string, input: MockTimedQuestion): Promise<MockQuestionAnswer | { pending: true; callId: string }>
  getRecords(sessionId: string): readonly SessionWireEvent[]
  appendEvent(sessionId: string, type: string, data: unknown): SessionWireEvent
  onRecord(listener: (sessionId: string, event: SessionWireEvent) => void): () => void
  remoteOf<T>(namespace: string): T | undefined
  setJobs(sessionId: string, rows: readonly SessionJob[]): void
  failJobRows(sessionId: string): void
  emitJobFrame(jobId: string, frame: JobFrame): void
  addRemote(namespace: string, impl: unknown): void
  /** Use payload.agent or payload.sessionId. Initial setup events wait for their first handler. */
  emit(event: string, payload?: unknown, options?: MockEmitOptions): Promise<unknown>
  streamAssistant(sessionId: string, text: string, options?: { chunkMs?: number; model?: { provider: string; model: string; reasoningEffort?: string } }): Promise<void>
  setProjection(sessionId: string, key: string, value: unknown): void
  /** Read the latest shared projection as an isolated copy; an absent key is undefined. */
  getProjection<T = unknown>(sessionId: string, key: string): T | undefined
  /** Replace a projection from its latest value; spread current to preserve other fields. */
  updateProjection<T>(sessionId: string, key: string, update: (current: T | undefined) => T): void
  /** Register the settings feature's authoritative synchronous value reader once. */
  registerSettingsReader(reader: (namespace: string) => unknown): void
  /** Read an isolated copy; no reader or missing namespace returns undefined. */
  getSettingsValue<T = unknown>(namespace: string): T | undefined
  /** Set lifecycle/error scenarios without changing a session's stable identity. */
  setSessionState(sessionId: string, patch: Partial<SessionSnapshot>): void
  removeSession(sessionId: string): void
  removeWorkspace(workspaceId: string): void
  patch(path: string, impl: unknown): void
  updateList(update: (state: SessionListState) => SessionListState | void): void
  scenario(name: string, setup: (kit: MockKit) => void): void
  /** Match the selected scenario before emitting demos; undefined means the default demo. */
  isScenario(...names: (string | undefined)[]): boolean
}
export type MockExtension = {
  /** Diagnostic origin supplied by the feature-module collector. */
  readonly source?: string
  extendMock(kit: MockKit): void
}
export interface MockOptions {
  scenario?: string; extensions?: readonly MockExtension[]; pageSize?: number
  readJobRows?: (id: string) => Promise<RemoteResult<readonly SessionJob[]>>
  readProjections?: (id: string, signal: AbortSignal) => Promise<RemoteResult<Record<string, unknown> | null>>
  openSession?: (id: string) => Promise<RemoteResult<null>>
  /** Admission and first journal delivery are deliberately independent. */
  beforeFirstTurn?: (id: string) => Promise<void>
  promptResponse?: (id: string) => Promise<RemoteResult<{ accepted: true }>>
  scheduleFrame?: (callback: () => void) => void
  imageLimits?: Partial<MockImageLimits>
}
export interface MockContext extends DshContext { readonly mock: MockKit; dispose(): void }

interface SessionModel {
  summary: SessionSummary
  agentAvailable: boolean
  snapshot: MutableSnapshot<SessionSnapshot>
  events: MutableSnapshot<SessionEventWindow>
  records: SessionWireEvent[]
  start: number
  hostProjections: Record<string, unknown>
  acceptedRequests: Set<string>
  projections: Map<string, MutableSnapshot<unknown>>
  attempt?: { id: string; turn: number; step: number; chunks: StreamChunk[]; token: number }
}

const success = <T>(value: T): RemoteResult<T> => ({ ok: true, value })
const failure = (code: string, message: string, details: Readonly<Record<string, unknown>> = {}): RemoteResult<never> => ({ ok: false, error: { code, message, details } })
const accepted = () => success({ accepted: true as const })
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue

/** Pure in-memory controller, independently testable without Vite or a Host. */
export function createMockContext(options: MockOptions = {}): MockContext {
  let serial = 0
  let disposed = false
  let preparing = true
  const id = (prefix: string) => `${prefix}-${++serial}`
  const models = new Map<string, SessionModel>()
  const handlers = new Map<string, Set<EventHandler>>()
  const recordListeners = new Set<(sessionId: string, event: SessionWireEvent) => void>()
  const startupEvents = new Set<{ event: string; owner?: SessionModel; deliver(): void; cancel(): void }>()
  const timers = new Map<ReturnType<typeof setTimeout>, { resolve(): void; owner?: SessionModel }>()
  const scenarios = new Map<string, (kit: MockKit) => void>()
  let settingsReader: ((namespace: string) => unknown) | undefined
  const attachments = new Map<string, { attachment: ImageAttachmentRef; data: Uint8Array }>([
    [imageAttachment.attachmentId, { attachment: imageAttachment, data: Uint8Array.from(atob(imageBase64), (character) => character.charCodeAt(0)) }],
  ])
  const remote: Record<string, unknown> = {}
  const selectedScenario = options.scenario
  const pageSize = Math.max(1, options.pageSize ?? 100)
  const connectionState = observable<ConnectionState>(undefined)
  let connectionLifetime = new AbortController()
  const gatewayOnly = new Set<string>()
  const scheduleFrame = options.scheduleFrame ?? ((callback: () => void) => {
    const frame = (globalThis as { requestAnimationFrame?: (callback: () => void) => void }).requestAnimationFrame
    if (frame) frame(callback)
    else void delay(0).then(callback)
  })
  const list = observable<SessionListState>({ ids: [], byId: {}, phase: 'ready', projectionsBySession: {} })
  const workspaceList = observable<WorkspaceSnapshot>({ items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null })
  const mockJobs = createMockJobs(options.readJobRows)
  remote.job = mockJobs.remote
  const hostJobs = mockJobs.host
  const projectionReads = new Map<string, { controller: AbortController; promise: Promise<void> }>()
  const readProjectionIds = new Set<string>()
  const unresolvedAddresses = new Set<string>()
  const retainObservers = new Map<string, MutableSnapshot<SessionRetainInfo>>()
  const scopeIds = new WeakMap<object, string>()
  const generations = new Map<string, { client: ReturnType<typeof makeClient>; binding: SessionBinding; sources: Record<string, number>; live: boolean; cleanups: Set<() => void> }>()

  function publishRetention(sessionId: string) {
    const retainedBy = { ...generations.get(sessionId)?.sources }
    const info = { retainedBy, referenceCount: Object.values(retainedBy).reduce((sum, n) => sum + n, 0) }
    retainObservers.get(sessionId)?.set(info)
    const model = models.get(sessionId)
    if (model) updateSummary(model, { retainedBy })
  }
  function generation(sessionId: string) {
    const existing = generations.get(sessionId)
    if (existing) return existing
    const model = getModel(sessionId)
    const client = makeClient(model)
    const record = { client, binding: undefined as unknown as SessionBinding, sources: Object.create(null) as Record<string, number>, live: true, cleanups: new Set<() => void>() }
    // Only controller-owned subscriptions belong to this generation. Direct
    // subscribers (especially projection faces shared across generations) must
    // unsubscribe themselves, exactly as the SDK's notifier subscriptions do.
    record.binding = { sessionId, session: client.face, ctx: { remote, sessionId, agent: sessionId }, eventSource: client.events }
    scopeIds.set(record.binding.ctx, sessionId)
    let previous = model.snapshot.getSnapshot()
    record.cleanups.add(model.snapshot.subscribe(() => {
      const next = model.snapshot.getSnapshot()
      const changes = Object.fromEntries(Object.keys(next).filter(key => next[key as keyof SessionSnapshot] !== previous[key as keyof SessionSnapshot]).map(key => [key, next[key as keyof SessionSnapshot]]))
      previous = next
      client.snapshot.update(state => ({ ...state, ...changes, ...(next.removed ? { loadingOlder: false, awaitingFirstTurn: false } : {}) }))
    }))
    record.cleanups.add(model.events.subscribe(() => {
      const host = model.events.getSnapshot()
      const current = client.events.getSnapshot()
      const change = host.change
      const entries = !isActive(model) ? []
        : change.kind === 'append' ? [...current.entries, ...change.entries]
        : change.kind === 'settle-assistant' ? [...current.entries.filter(entry => entry.type !== 'transient' || entry.event.data.attemptId !== change.attemptId), ...(change.entry ? [change.entry] : [])]
        : [...model.records.slice(client.start).map(event => ({ type: 'event' as const, event })), ...host.entries.filter(entry => entry.type === 'transient')]
      if (!client.opened) return
      client.events.set({ entries, change, hasMore: isActive(model) && client.start > 0, revision: current.revision + 1 })
      for (const entry of entries) if (entry.type === 'event') observeSubmission(model, entry.event, client)
    }))
    generations.set(sessionId, record)
    return record
  }

  const isActive = (model: SessionModel) => !disposed && models.get(model.summary.id) === model
  const delay = (ms: number, owner?: SessionModel) => new Promise<void>((resolve) => {
    if (disposed || (owner && !isActive(owner))) { resolve(); return }
    const timer = setTimeout(() => { timers.delete(timer); resolve() }, Math.max(0, ms))
    timers.set(timer, { resolve, owner })
  })
  function cancelTimers(owner: SessionModel) {
    for (const [timer, pending] of timers) {
      if (pending.owner !== owner) continue
      clearTimeout(timer)
      timers.delete(timer)
      pending.resolve()
    }
  }
  async function deliverEvent(event: string, args: unknown[], sessionId: string | undefined, owner: SessionModel | undefined): Promise<unknown> {
    if (disposed || (owner && !isActive(owner))) return undefined
    const selected = [...(handlers.get(event) ?? [])]
    if (event !== 'approval/request' && event !== 'user-questions/request') {
      return Promise.all(selected.map(handler => Promise.resolve().then(() => handler.apply({ remote }, args))))
    }
    if (sessionId && !models.has(sessionId)) {
      gatewayOnly.add(sessionId)
      kit.addSession({ id: sessionId, displayTitle: sessionId, running: false, blank: true, updatedAt: 0 }, [])
    }
    const reference = sessionId ? retainTarget(sessionId, { source: 'gateway' }, false) : undefined
    const scope = reference?.binding.ctx ?? { remote }
    const input = args[0] as { signal?: AbortSignal }
    const signal = AbortSignal.any([connectionLifetime.signal, ...(input?.signal ? [input.signal] : [])])
    const request = { ...input, agent: scope, signal }
    let cancel: () => void = () => {}
    try {
    const invoke = async (index: number): Promise<unknown> => {
      if (signal.aborted) return undefined
      const handler = selected[index]
      return handler ? handler.call(scope, request, () => invoke(index + 1)) : undefined
    }
    const cancelled = new Promise<undefined>((resolve, reject) => {
      cancel = () => input?.signal?.aborted
        ? reject(event === 'user-questions/request' ? Object.assign(new Error('質問を取り消しました。'), { name: 'UserQuestionError', code: 'ASK_ABORTED' }) : input.signal.reason)
        : resolve(undefined)
      signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
    })
    if (signal.aborted) return await cancelled
    return await Promise.race([invoke(0), cancelled])
    } finally { signal.removeEventListener('abort', cancel); reference?.release() }
  }
  const getModel = (sessionId: string): SessionModel => {
    const model = models.get(sessionId)
    if (!model) throw new Error(`偽のセッションが見つかりません: ${sessionId}`)
    return model
  }
  function updateSummary(model: SessionModel, patch: Partial<SessionSummary>) {
    if (!isActive(model)) return
    model.summary = { ...model.summary, ...patch }
    if (!gatewayOnly.has(model.summary.id)) list.update((state) => ({ ...state, byId: { ...state.byId, [model.summary.id]: model.summary } }))
  }
  function publish(model: SessionModel, entries: readonly SessionEventLikeEntry[], change: SessionEventChange) {
    if (!isActive(model)) return
    model.events.update((window) => ({ entries, change, hasMore: model.start > 0, revision: window.revision + 1 }))
  }
  function replaceWindow(model: SessionModel) {
    const entries: SessionEventLikeEntry[] = model.records.slice(model.start).map((event) => ({ type: 'event', event }))
    if (model.attempt) {
      const attempt = model.attempt
      const after = model.records.at(-1)?.seq ?? -1
      attempt.chunks.forEach((chunk, index) => entries.push({ type: 'transient', event: { type: 'assistant/live-chunk', seq: after + (index + 1) / (attempt.chunks.length + 1), time: Date.now(), data: { attemptId: attempt.id, turn: attempt.turn, step: attempt.step, chunk } } }))
    }
    publish(model, entries, { kind: 'replace', entries })
  }
  function append(model: SessionModel, type: string, data: unknown): SessionWireEvent {
    const event: SessionWireEvent = { type, data: json(data), seq: (model.records.at(-1)?.seq ?? -1) + 1, time: Date.now(), ...(['user/message', 'assistant/message', 'tool/result', 'system/message'].includes(type) ? { surfaceOp: 'append' } : {}) }
    if (!isActive(model)) return event
    model.records.push(event)
    for (const listener of recordListeners) listener(model.summary.id, event)
    const entry: SessionEventLikeEntry = { type: 'event', event }
    publish(model, [...model.events.getSnapshot().entries, entry], { kind: 'append', entries: [entry] })
    return event
  }
  function running(model: SessionModel, value: boolean) {
    if (!isActive(model)) return
    model.snapshot.update((state) => ({ ...state, running: value, blank: false }))
    updateSummary(model, { running: value, blank: false, updatedAt: Date.now() })
  }
  function turnOf(model: SessionModel): number {
    const start = [...model.records].reverse().find((event) => event.type === 'turn/start')
    return start && typeof start.data === 'object' && start.data !== null && 'turn' in start.data ? Number(start.data.turn) : 0
  }
  function endTurn(model: SessionModel) {
    settleAttempt(model)
    const step = [...model.records].reverse().find(event => event.type.startsWith('step/'))
    if (step?.type === 'step/start') append(model, 'step/end', step.data)
    const turn = [...model.records].reverse().find(event => event.type.startsWith('turn/'))
    if (turn?.type === 'turn/start') append(model, 'turn/end', { turn: turnOf(model), reason: { kind: 'aborted', reason: { kind: 'user' } } })
  }
  function beginTurn(model: SessionModel, content: readonly ContentBlock[], requestId?: string) {
    const turn = turnOf(model) + 1
    append(model, 'turn/start', { turn })
    append(model, 'user/message', { id: id('message'), role: 'user', content, source: { kind: 'user', ...(requestId ? { rpcId: requestId } : {}) } })
    append(model, 'step/start', { turn, step: 1 })
    running(model, true)
  }
  function observeSubmission(model: SessionModel, event: SessionWireEvent, client: ReturnType<typeof makeClient>) {
    if (event.type === 'turn/start') client.snapshot.update(state => ({ ...state, awaitingFirstTurn: false }))
    if (event.type === 'user/message') observeMessage(model, event.data, client, true)
  }
  function observeMessage(model: SessionModel, value: unknown, client: ReturnType<typeof makeClient>, admitted: boolean) {
    const message = value as { source?: { kind?: string; rpcId?: string }; content?: ContentBlock[] }
    const requestId = message.source?.kind === 'user' ? message.source.rpcId : undefined
    if (!requestId || !client.submissions.has(requestId) || client.retiring.has(requestId)) return
    if (!admitted && client.snapshot.getSnapshot().pendingSubmissions.find(row => row.requestId === requestId)?.placement !== 'queued') return
    client.retiring.add(requestId)
    scheduleFrame(() => retire(model, requestId, { reason: 'observed', attachments: (message.content ?? []).flatMap(block => block.type === 'image' || block.type === 'file' ? [block.attachment] : []) }, client))
  }
  function retire(model: SessionModel, requestId: string | undefined, retirement: PendingSubmissionRetirement, client = generations.get(model.summary.id)?.client) {
    if (!requestId || !client) return
    // A latched observation owns its next-frame callback, including during teardown.
    if (retirement.reason === 'failed' && client.retiring.has(requestId)) return
    const pending = client.submissions.get(requestId)
    if (!pending) return
    client.submissions.delete(requestId)
    client.retiring.delete(requestId)
    client.snapshot.update((state) => ({ ...state, pendingSubmissions: state.pendingSubmissions.filter((row) => row.requestId !== requestId) }))
    pending.onRetire?.(retirement)
  }
  function settleAttempt(model: SessionModel, commit?: SessionWireEvent) {
    if (!model.attempt) return
    const attemptId = model.attempt.id
    model.attempt = undefined
    const entries = model.events.getSnapshot().entries.filter((entry) => entry.type !== 'transient' || entry.event.data.attemptId !== attemptId)
    const entry = commit ? { type: 'event' as const, event: commit } : undefined
    publish(model, entry ? [...entries, entry] : entries, { kind: 'settle-assistant', attemptId, ...(entry ? { entry } : {}) })
  }
  function advanceQueue(model: SessionModel) {
    if (!isActive(model)) return
    admitQuestionReplies(model)
    const inbox = project(model, 'inbox').getSnapshot() as InboxState | undefined
    const first = inbox?.['next-turn'][0]
    if (!first) return
    kit.setProjection(model.summary.id, 'inbox', { ...inbox, 'next-turn': inbox!['next-turn'].slice(1) })
    beginTurn(model, first.content, first.source.rpcId)
    if (!isActive(model)) return
    void kit.streamAssistant(model.summary.id, '順番待ちのメッセージを受け取りました。', { chunkMs: 30 })
  }
  function admitQuestionReplies(model: SessionModel) {
    if (!isActive(model) || !model.agentAvailable) return
    const inbox = kit.getProjection<InboxState>(model.summary.id, 'inbox')
    const replies = inbox?.['next-step'].filter(row => row.source.kind === 'user-question-reply') ?? []
    for (const message of replies) {
      // The durable admission, rather than RPC completion, settles the card.
      append(model, 'user/message', message)
      const payload = JSON.parse((message.content[0] as { text: string }).text) as { callId: string; answers: MockQuestionAnswer['answers'] }
      mockQuestions.admitted(model.summary.id, payload.callId, { answers: payload.answers })
      kit.updateProjection<InboxState>(model.summary.id, 'inbox', current => ({ 'next-turn': current?.['next-turn'] ?? [], 'next-step': current?.['next-step'].filter(row => row.id !== message.id) ?? [] }))
    }
  }
  function project(model: SessionModel, key: string): MutableSnapshot<unknown> {
    let source = model.projections.get(key)
    if (!source) { source = observable<unknown>(undefined); model.projections.set(key, source) }
    return source
  }


  function makeClient(model: SessionModel) {
    const summary = model.summary
    const start = Math.max(0, model.records.length - pageSize)
    const snapshot = lifecycle<SessionSnapshot>({ ...model.snapshot.getSnapshot(), openState: 'cold', pendingSubmissions: [], promptAttempted: false, promptError: null, awaitingFirstTurn: false, loadingOlder: false, hasMore: false })
    const entries: SessionEventLikeEntry[] = []
    const eventSource = observable<SessionEventWindow>({ entries, hasMore: false, revision: 1, change: { kind: 'replace', entries } })
    let jump: Promise<void> | undefined
    let jumpTarget = 0
    const client = { start, snapshot, events: eventSource, submissions: new Map<string, BeginSubmissionInput>(), retiring: new Set<string>(), opening: undefined as Promise<void> | undefined, opened: false, live: true, face: undefined as unknown as SessionFace }
    const retireSubmission = (requestId: string | undefined, retirement: PendingSubmissionRetirement) => {
      retire(model, requestId, retirement, client)
    }
    const face: SessionFace = {
      sessionId: summary.id, getSnapshot: snapshot.getSnapshot, subscribe: snapshot.subscribe,
      projections: { faceOf: (key) => project(model, key) },
      beginSubmission(input) {
        const requestId = id('request')
        if (!isActive(model)) {
          input.onRetire?.({ reason: 'failed' })
          return { requestId, abandon() {} }
        }
        client.submissions.set(requestId, input)
        snapshot.update((state) => ({ ...state, promptAttempted: true, pendingSubmissions: [...state.pendingSubmissions, { requestId, placement: state.running ? (input.mode === 'steer' ? 'steering' : 'queued') : 'transcript', time: Date.now(), text: input.text, attachments: input.attachments }] }))
        return { requestId, abandon: () => retireSubmission(requestId, { reason: 'failed' }) }
      },
      async prompt(parts, mode, signal, requestId) {
        if (!isActive(model)) return failure('session/not-found', '会話が見つかりません。')
        snapshot.update((state) => ({ ...state, promptAttempted: true, promptError: null, lastAgentError: null, awaitingFirstTurn: state.awaitingFirstTurn || state.blank }))
        const rejectPrompt = (code: string, message: string, details = {}) => {
          const result = failure(code, message, details)
          if (!result.ok) snapshot.update(state => ({ ...state, promptError: { op: 'send', error: result.error } }))
          retireSubmission(requestId, { reason: 'failed' })
          return result
        }
        await Promise.resolve()
        if (!parts.some(part => part.type !== 'text' || part.text.trim())) return rejectPrompt('gateway/bad-request', '空白以外のメッセージを入力してください。')
        const address = snapshot.getSnapshot().subagent?.address
        if (address && parts.some(part => part.type === 'file')) return rejectPrompt('subagent/attachment-invalid', '子の会話にファイルは送れません。', { reason: 'SUBAGENT_FILE_UNSUPPORTED' })
        if (address && !models.get(address.parentSessionId)?.agentAvailable) return rejectPrompt('subagent/parent-unavailable', '親の会話を利用できません。')
        if (summary.origin === 'subagent') {
          const error = validateAddress(model, address)
          if (error) return rejectPrompt(error.code, error.message, error.details)
          if ((model.hostProjections.subagent as { mode: string }).mode !== 'continuable') return rejectPrompt('subagent/not-resumable', 'この子の会話は続けられません。')
        }
        if (!address && requestId && model.acceptedRequests.has(requestId)) return accepted()
        if (parts.some(part => part.type === 'file')) return rejectPrompt('session/attachment-invalid', '添付ファイルの受付情報が見つかりません。', { reason: 'FILE_NOT_STAGED' })
        if (signal?.aborted || connectionState.getSnapshot() !== 'connected') {
          const result = failure(signal?.aborted ? 'gateway/cancelled' : 'gateway/internal', signal?.aborted ? '送信を取り消しました。' : '接続が切れています。')
          if (!result.ok) snapshot.update((state) => ({ ...state, promptError: { op: 'send', error: result.error } }))
          retireSubmission(requestId, { reason: 'failed' })
          return result
        }
        let content: ContentBlock[]
        try {
          const admittedImages = admitMockImages(parts, options.imageLimits)
          let imageIndex = 0
          content = parts.map((part) => {
            if (part.type === 'text') return { type: 'text', text: part.text }
            if (part.type === 'image') {
              const { data, facts } = admittedImages[imageIndex++]!
              const attachment = { ...facts, attachmentId: id('image') }
              attachments.set(attachment.attachmentId, { attachment, data })
              return { type: 'image', attachment }
            }
            return { type: 'file', attachment: { attachmentId: part.receiptId, name: '添付ファイル', bytes: 0 } }
          })
        } catch (error) {
          const result = failure(address ? 'subagent/attachment-invalid' : 'session/attachment-invalid', '画像のデータを読み込めませんでした。', { reason: (error as { reason?: string }).reason ?? 'INVALID_IMAGE' })
          if (!result.ok) snapshot.update((state) => ({ ...state, promptError: { op: 'send', error: result.error } }))
          retireSubmission(requestId, { reason: 'failed' })
          return result
        }
        const wireId = address ? id('child-request') : requestId ?? id('request')
        kit.setAgentAvailable(summary.id, true)
        if (!address && requestId) model.acceptedRequests.add(requestId)
        if (snapshot.getSnapshot().running && mode === 'queue') {
          kit.updateProjection<InboxState>(summary.id, 'inbox', inbox => ({ 'next-step': inbox?.['next-step'] ?? [], 'next-turn': [...(inbox?.['next-turn'] ?? []), { id: id('message'), role: 'user', source: { kind: 'user', rpcId: wireId }, content }] }))
        } else {
          if (snapshot.getSnapshot().running) endTurn(model)
          const deliver = () => {
            if (!isActive(model)) return
            beginTurn(model, content, wireId)
            if (isActive(model)) void kit.streamAssistant(summary.id, 'メッセージを受け取りました。これは偽データによる応答です。', { chunkMs: 30 })
          }
          if (options.beforeFirstTurn) void options.beforeFirstTurn(summary.id).then(deliver)
          else deliver()
        }
        snapshot.update(state => ({ ...state, blank: false }))
        const response = options.promptResponse ? await options.promptResponse(summary.id) : accepted()
        if (signal?.aborted) return rejectPrompt('gateway/cancelled', '送信を取り消しました。')
        if (!response.ok) return rejectPrompt(response.error.code, response.error.message, response.error.details)
        return response
      },
      async updateQueue(itemId, action) {
        await Promise.resolve()
        const inbox = project(model, 'inbox').getSnapshot() as InboxState | undefined
        if (action.kind === 'edit') {
          if (action.content.some(block => block.type !== 'text')) return failure('session/attachment-invalid', 'テキストだけを編集できます。', { reason: 'QUEUE_EDIT_NON_TEXT' })
          if (!action.content.some(block => block.text.trim())) return failure('gateway/bad-request', '空白以外のメッセージを入力してください。')
        }
        if (model.summary.origin === 'subagent' && (model.hostProjections.subagent as { mode?: string } | undefined)?.mode !== 'continuable') return failure('session/agent-busy', 'この子の会話の待機列は変更できません。')
        if (!isActive(model)) return failure('session/queue-item-not-found', '順番待ちのメッセージが見つかりません。', { itemId })
        const target = inbox?.['next-turn'].some(row => row.id === itemId) ? 'next-turn' : 'next-step'
        const item = inbox?.[target].find(row => row.id === itemId)
        if (!item) return failure('session/queue-item-not-found', '順番待ちのメッセージが見つかりません。', { itemId })
        if (action.kind === 'steer' && (target !== 'next-turn' || !model.snapshot.getSnapshot().running)) return failure('session/steer-unavailable', '今は割り込めません。', { itemId })
        if (action.kind === 'edit') kit.setProjection(summary.id, 'inbox', { ...inbox, [target]: inbox![target].map(row => row.id === itemId ? { ...row, content: action.content } : row) })
        else {
          kit.setProjection(summary.id, 'inbox', { ...inbox, [target]: inbox![target].filter(row => row.id !== itemId) })
          if (action.kind === 'steer') {
            endTurn(model)
            beginTurn(model, item.content, item.source.rpcId)
            if (isActive(model)) void kit.streamAssistant(summary.id, '割り込みのメッセージを受け取りました。', { chunkMs: 30 })
          }
        }
        return accepted()
      },
      async cancel() {
        await Promise.resolve()
        const address = snapshot.getSnapshot().subagent?.address
        const denied = !isActive(model) ? address ? undefined : failure('session/not-found', '会話が見つかりません。')
          : address ? model.summary.origin !== 'subagent' || model.summary.parentId !== address.parentSessionId ? failure('subagent/unauthorized', '子の会話の親が一致しません。') : undefined
          : model.summary.origin === 'subagent' ? failure('session/agent-busy', '子の会話には親のアドレスが必要です。') : undefined
        if (denied && !denied.ok) { snapshot.update(value => ({ ...value, promptError: { op: 'stop', error: denied.error } })); return denied }
        // interruptByParent is a no-op for a child without a live Agent.
        if (!isActive(model)) return accepted()
        settleAttempt(model)
        if (snapshot.getSnapshot().running) endTurn(model)
        running(model, false)
        void delay(0, model).then(() => { if (isActive(model)) advanceQueue(model) })
        return accepted()
      },
      async rename(title) {
        await Promise.resolve()
        if (model.summary.origin === 'subagent') return failure('session/agent-busy', '子の会話はこの操作を利用できません。')
        if (!isActive(model)) return failure('session/not-found', '会話が見つかりません。')
        const normalized = normalizeMockTitle(title)
        if (!normalized) return failure('session/title-invalid', '題名を入力してください。', { sessionId: model.summary.id })
        updateSummary(model, { title: normalized, displayTitle: normalized })
        const event = append(model, 'session/title', { title: normalized })
        kit.setProjection(summary.id, 'title', normalized)
        return success({ title: normalized, seq: event.seq })
      },
      async loadOlder() {
        if (!isActive(model) || !client.live || snapshot.getSnapshot().openState !== 'open' || client.start === 0 || snapshot.getSnapshot().loadingOlder) return
        snapshot.update(state => ({ ...state, loadingOlder: true }))
        try {
          await Promise.resolve()
          if (!isActive(model) || !client.live) return
          prepend(Math.max(0, client.start - pageSize))
        } finally { snapshot.update(state => ({ ...state, loadingOlder: false })) }
      },
      loadThrough(seq) {
        if (!isActive(model) || !client.live || snapshot.getSnapshot().openState !== 'open' || client.start === 0 || (model.records[client.start]?.seq ?? 0) <= seq) return Promise.resolve()
        if (jump) { jumpTarget = Math.min(jumpTarget, seq); return jump }
        if (snapshot.getSnapshot().loadingOlder) return Promise.resolve()
        jumpTarget = seq
        snapshot.update(state => ({ ...state, loadingOlder: true }))
        jump = (async () => {
          let pendingStart = client.start
          try {
            while (pendingStart > 0 && (model.records[pendingStart]?.seq ?? 0) > jumpTarget) {
              const before = pendingStart
              await Promise.resolve()
              if (!isActive(model) || !client.live) return
              pendingStart = Math.max(0, pendingStart - pageSize)
              if (pendingStart >= before) return
            }
          } finally {
            jump = undefined
            if (isActive(model) && client.live && pendingStart < client.start) prepend(pendingStart)
            snapshot.update(state => ({ ...state, loadingOlder: false }))
          }
        })()
        return jump
      },
      async command(line) {
        await Promise.resolve()
        if (!isActive(model)) return failure('session/not-found', '会話が見つかりません。')
        const [name, ...args] = line.trim().replace(/^\//, '').split(/\s+/)
        if (!name || !['permission', 'plan', 'model', 'help', 'clear'].includes(name)) return success({ matched: false })
        const commandId = id('command')
        append(model, 'command/run', { commandId, name, args: args.join(' '), source: { kind: 'user' } })
        if (name === 'plan') kit.setProjection(summary.id, 'plan', { active: args[0] !== 'off', pending: false })
        if (name === 'permission' && args[0]) kit.setProjection(summary.id, 'permissions', { ...(project(model, 'permissions').getSnapshot() as object), currentValue: args[0] })
        append(model, 'command/done', { commandId, kind: 'success', text: `/${name} を実行しました` })
        return success({ matched: true })
      },
      async readAttachment(attachmentId) {
        await Promise.resolve()
        if (!isActive(model)) return failure('session/not-found', '会話が見つかりません。')
        const referenced = referencesImage(model.records, attachmentId)
        if (!referenced) return failure('session/attachment-invalid', 'この会話で使われていない画像です。', { reason: 'ATTACHMENT_NOT_REFERENCED' })
        const value = attachments.get(attachmentId)
        return value ? success({ attachment: { ...value.attachment }, data: value.data.slice() }) : failure('session/attachment-invalid', '画像が見つかりません。', { reason: 'ATTACHMENT_NOT_FOUND' })
      },
    }
    function prepend(start: number) {
      const older: SessionEventLikeEntry[] = model.records.slice(start, client.start).map(event => ({ type: 'event', event }))
      client.start = start
      eventSource.update(window => ({ entries: [...older, ...window.entries], change: { kind: 'prepend', entries: older }, hasMore: start > 0, revision: window.revision + 1 }))
      snapshot.update(state => ({ ...state, hasMore: start > 0 }))
    }
    client.face = face
    return client
  }

  function publishProjection(sessionId: string, values: Readonly<Record<string, unknown>>, state: 'idle' | 'loading' | 'ready' | 'error', error: RemoteFailure | null) {
    const model = models.get(sessionId)
    if (model) {
      for (const key of new Set([...model.projections.keys(), ...Object.keys(values)])) project(model, key).set(values[key])
      model.summary = { ...model.summary, projectionValues: values }
    }
    list.update(list => ({ ...list, ...(model ? { byId: { ...list.byId, [sessionId]: model.summary } } : {}),
      projectionsBySession: { ...list.projectionsBySession, [sessionId]: { values, state, error } } }))
  }

  function validateAddress(model: SessionModel, address: SubagentAddress | undefined): RemoteFailure | null {
    const sessionId = model.summary.id
    const fail = (code: string, message: string, details = {}): RemoteFailure => ({ code, message, details })
    if (unresolvedAddresses.has(sessionId)) return fail(address ? 'subagent/not-found' : 'session/not-found', '会話が見つかりません。', { sessionId })
    if (!address) return model.summary.origin === 'subagent' ? fail('session/agent-busy', '子の会話には親のアドレスが必要です。') : null
    if (model.summary.origin !== 'subagent' || model.summary.parentId !== address.parentSessionId) return fail('subagent/unauthorized', '子の会話の親が一致しません。', { childSessionId: sessionId })
    const identity = model.hostProjections.subagent as { mode: string; seq: number } | null | undefined
    const inherited = model.records.find(event => event.type === 'session/end-seed')?.seq ?? 0
    if (identity == null || identity.seq < inherited) return fail('subagent/catalog-diagnostic', '子の会話の情報を読み込めません。', { reason: identity === null ? 'corrupt' : 'unsupported' })
    return address.mode !== 'unknown' && identity.mode !== address.mode ? fail('subagent/unauthorized', '子の会話の種類が一致しません。', { childSessionId: sessionId }) : null
  }
  // MockKit supplies Host data; a catalog fixture establishes a child's durable
  // descriptor once. Later caller addresses/catalog edits cannot change it.
  function seedChildDescriptor(parentId: string, rows: readonly SubagentCatalogEntry[]) {
    for (const row of rows) {
      const child = models.get(row.id)
      if (child?.summary.parentId === parentId && child.summary.origin === 'subagent' && !Object.hasOwn(child.hostProjections, 'subagent') && row.mode !== 'unknown') {
        child.hostProjections.subagent = { mode: row.mode, seq: 0, ...('label' in row ? { label: row.label } : {}) }
      }
    }
  }

  function commandError(code: string, message: string, structured = false, details: Record<string, unknown> = {}): Error {
    const error = new Error(code + ': ' + message)
    return structured ? Object.assign(error, { rpcError: { code, message, details } }) : error
  }
  function attachSession(workspace: WorkspaceView, sessionId: string) {
    workspaceList.update(state => ({ ...state, items: state.items.map(item => item.workspaceId === workspace.workspaceId && !item.sessionIds.includes(sessionId) ? { ...item, sessionIds: [sessionId, ...item.sessionIds] } : item) }))
  }
  function increasedForkTitle(title: string) {
    const ascii = /^(.*?)\((\d+)\)$/u.exec(title)
    if (ascii) return ascii[1] + '(' + (BigInt(ascii[2]!) + 1n) + ')'
    const full = /^(.*?)（(\d+)）$/u.exec(title)
    if (full) return full[1] + '（' + (BigInt(full[2]!) + 1n) + '）'
    return title + ' (1)'
  }
  let defaultWorkspaceId: string | undefined
  function runningDescendants(sessionId: string) {
    const result: SessionModel[] = [], pending = [sessionId], visited = new Set<string>()
    while (pending.length) {
      const parent = pending.pop()!
      if (visited.has(parent)) continue
      visited.add(parent)
      for (const child of models.values()) {
        if (child.summary.origin !== 'subagent' || child.summary.parentId !== parent || !child.agentAvailable) continue
        pending.push(child.summary.id)
        if (child.snapshot.getSnapshot().running) result.push(child)
      }
    }
    return result
  }
  const workspaces: IWorkspaces = {
    list: workspaceList,
    async initializeDefault(signal) {
      await Promise.resolve()
      if (signal?.aborted) throw commandError('gateway/cancelled', '初期化を取り消しました。', true)
      const state = workspaceList.getSnapshot()
      if (defaultWorkspaceId) return state.items.find(item => item.workspaceId === defaultWorkspaceId)
      if (state.items.length || state.archivedSessionIds.length || models.size) return undefined
      const workspace = await workspaces.create({ path: '/mock/Documents/DeepSeek' })
      defaultWorkspaceId = workspace.workspaceId
      return workspace
    },
    async unarchiveSession(sessionId) { await Promise.resolve(); workspaceList.update(state => ({ ...state, archivedSessionIds: state.archivedSessionIds.filter(id => id !== sessionId) })) },
    async pinSession(id) {
      await Promise.resolve()
      if (workspaceList.getSnapshot().pinnedSessionIds.includes(id)) return
      if (!models.has(id)) throw commandError('session/not-found', '会話が見つかりません。')
      if (workspaceList.getSnapshot().archivedSessionIds.includes(id)) throw commandError('gateway/bad-request', 'アーカイブした会話は固定できません。')
      workspaceList.update(state => ({ ...state, pinnedSessionIds: [id, ...state.pinnedSessionIds.filter(value => value !== id)] })) },
    async unpinSession(id) { await Promise.resolve(); workspaceList.update(state => ({ ...state, pinnedSessionIds: state.pinnedSessionIds.filter(value => value !== id) })) },
    async create({ path }) {
      await Promise.resolve()
      if (!path.startsWith('/') || path.includes('\0')) throw commandError('workspace/invalid-path', '絶対パスを指定してください。', true)
      path = '/' + path.split('/').filter(Boolean).reduce<string[]>((parts, part) => { if (part === '..') parts.pop(); else if (part !== '.') parts.push(part); return parts }, []).join('/')
      const previous = workspaceList.getSnapshot().items.find((item) => item.path === path)
      if (previous) return previous
      const now = new Date().toISOString()
      const workspace: WorkspaceView = { workspaceId: id('workspace'), path, title: path.split('/').filter(Boolean).at(-1) ?? 'ワークスペース', sessionIds: [], createdAt: now, updatedAt: now }
      workspaceList.update(state => ({ ...state, items: [workspace, ...state.items] }))
      return workspace
    },
    async rename(workspaceId, title) {
      await Promise.resolve()
      title = title.trim()
      if (!title) throw commandError('gateway/bad-request', '名前を入力してください。')
      const previous = workspaceList.getSnapshot().items.find((item) => item.workspaceId === workspaceId)
      if (!previous) throw commandError('workspace/not-found', 'ワークスペースが見つかりません。')
      if (workspaceList.getSnapshot().items.some(item => item.workspaceId !== workspaceId && item.title === title)) throw commandError('workspace/name-conflict', '同じ名前が使われています。')
      const next = { ...previous, title, updatedAt: new Date().toISOString() }
      workspaceList.update((state) => ({ ...state, items: state.items.map((item) => item.workspaceId === workspaceId ? next : item) }))
      return next
    },
    async delete(workspaceId) { await Promise.resolve(); if (!workspaceList.getSnapshot().items.some(item => item.workspaceId === workspaceId)) throw commandError('workspace/not-found', 'ワークスペースが見つかりません。'); kit.removeWorkspace(workspaceId) },
    async insertBefore(workspaceId, beforeWorkspaceId) {
      const items = workspaceList.getSnapshot().items
      if (!items.some(item => item.workspaceId === workspaceId) || (beforeWorkspaceId !== undefined && !items.some(item => item.workspaceId === beforeWorkspaceId))) throw commandError('workspace/not-found', 'ワークスペースが見つかりません。')
      workspaceList.update((state) => {
        const target = state.items.find((item) => item.workspaceId === workspaceId)
        if (!target || workspaceId === beforeWorkspaceId) return state
        const items = state.items.filter((item) => item !== target)
        const index = items.findIndex((item) => item.workspaceId === beforeWorkspaceId)
        items.splice(index < 0 ? items.length : index, 0, target)
        return { ...state, items }
      })
    },
    async archiveSession(sessionId, options) {
      await Promise.resolve()
      if (workspaceList.getSnapshot().archivedSessionIds.includes(sessionId)) return
      const model = models.get(sessionId)
      if (!model) throw commandError('session/not-found', '会話が見つかりません。', true, { sessionId })
      const descendants = runningDescendants(sessionId)
      const ownedJob = (row: SessionJob) => row.owner === sessionId && (row.status === 'running' || row.status === 'stopping')
      if ((model.snapshot.getSnapshot().running || descendants.length || [...hostJobs.values()].some(rows => rows.some(ownedJob))) && !options?.stopActivity) {
        throw commandError('workspace/session-active', '会話で処理が実行中です。', true, { sessionId })
      }
      workspaceList.update((state) => ({ ...state, archivedSessionIds: [...new Set([...state.archivedSessionIds, sessionId])], pinnedSessionIds: state.pinnedSessionIds.filter(id => id !== sessionId) }))
      if (options?.stopActivity) {
        for (const active of [model, ...descendants]) { settleAttempt(active); running(active, false) }
        for (const [owner, rows] of hostJobs) kit.setJobs(owner, rows.map(row => ownedJob(row) ? { ...row, status: 'killed', finishedAt: Date.now() } : row))
      }
    },
    async insertSessionBefore(workspaceId, sessionId, beforeSessionId) {
      await Promise.resolve()
      const workspace = workspaceList.getSnapshot().items.find((item) => item.workspaceId === workspaceId)
      if (!workspace) throw commandError('workspace/not-found', 'ワークスペースが見つかりません。')
      if (!workspace.sessionIds.includes(sessionId) || (beforeSessionId !== undefined && !workspace.sessionIds.includes(beforeSessionId))) throw commandError('workspace/move-invalid', '並べ替える会話がワークスペースにありません。')
      if (sessionId === beforeSessionId && workspace.sessionIds.includes(sessionId)) return workspace
      const sessionIds = workspace.sessionIds.filter((value) => value !== sessionId)
      const index = sessionIds.indexOf(beforeSessionId ?? '')
      sessionIds.splice(index < 0 ? sessionIds.length : index, 0, sessionId)
      const next = { ...workspace, sessionIds, updatedAt: new Date().toISOString() }
      workspaceList.update((state) => ({ ...state, items: state.items.map((item) => item.workspaceId === workspaceId ? next : item) }))
      return next
    },
  }

  function retainTarget(target: SessionTarget, { source, signal }: { source: string; signal?: AbortSignal }, open = true): SessionReference {
      signal?.throwIfAborted()
      if (disposed) throw new Error('Session Controller is disposed')
      const sessionId = typeof target === 'string' ? target : target.childSessionId
      const address = typeof target === 'string' ? sessions.subagentAddress(target) : target
      if (open && typeof target === 'string' && !generations.has(sessionId) && !list.getSnapshot().byId[sessionId] && !address) throw new Error(`sessions.retain: unknown session ${sessionId}`)
      // A durable address is admitted locally; missing children fail at open, as on the Host.
      if (!models.has(sessionId)) {
        unresolvedAddresses.add(sessionId)
        kit.addSession({ id: sessionId, displayTitle: sessionId, running: false, blank: true, updatedAt: 0, origin: 'subagent', parentId: address?.parentSessionId }, [])
        kit.setSessionState(sessionId, { openState: 'error', openError: { code: 'session/not-found', message: '会話が見つかりません。', details: {} } })
      }
      const model = getModel(sessionId)
      const record = generation(sessionId)
      if (address) record.client.snapshot.update(state => ({ ...state, subagent: { address, parentAvailable: models.get(address.parentSessionId)?.agentAvailable ?? false } }))
      record.sources[source] = (record.sources[source] ?? 0) + 1
      let released = false
      let rejectReady: (error: unknown) => void = () => {}
      if (open && !record.client.opening && record.client.snapshot.getSnapshot().openState !== 'open') {
        record.client.snapshot.update(state => ({ ...state, openState: 'loading', openError: null }))
        record.client.opening = (async () => {
          const result = await (options.openSession?.(sessionId) ?? Promise.resolve(success(null)))
          if (!record.live) return
          const error = result.ok ? validateAddress(model, record.client.snapshot.getSnapshot().subagent?.address) : result.error
          const host = model.snapshot.getSnapshot()
          const openError = error ?? host.openError
          if (!openError && isActive(model)) {
            record.client.opened = true
            const entries: SessionEventLikeEntry[] = [...model.records.slice(record.client.start).map(event => ({ type: 'event' as const, event })), ...model.events.getSnapshot().entries.filter(entry => entry.type === 'transient')]
            record.client.events.update(window => ({ entries, hasMore: record.client.start > 0, revision: window.revision + 1, change: { kind: 'replace', entries } }))
            for (const entry of entries) if (entry.type === 'event') observeSubmission(model, entry.event, record.client)
            publishProjection(sessionId, structuredClone(model.hostProjections), 'ready', null)
            const inbox = model.hostProjections.inbox as InboxState | undefined
            if (inbox) for (const message of [...inbox['next-turn'], ...inbox['next-step']]) observeMessage(model, message, record.client, false)
          }
          record.client.snapshot.update(state => ({ ...state, openState: openError ? 'error' : 'open', openError, hasMore: !openError && record.client.start > 0 }))
        })().finally(() => { record.client.opening = undefined })
      }
      const ready = new Promise<SessionBinding>((resolve, reject) => {
        rejectReady = reject
        void (open ? record.client.opening ?? Promise.resolve() : Promise.resolve()).then(() => {
          if (released || !record.live) return
          record.cleanups.delete(cancelReady)
          resolve(record.binding)
        }, reject)
      })
      const cancelReady = () => rejectReady(new Error('Session generation is disposed'))
      record.cleanups.add(cancelReady)
      void ready.catch(() => {})
      const release = () => {
        if (released) return
        released = true
        signal?.removeEventListener('abort', abortReady)
        record.cleanups.delete(cancelReady)
        record.cleanups.delete(release)
        rejectReady(signal?.reason ?? new Error('Session reference released'))
        if (!record.live) return
        const count = (record.sources[source] ?? 1) - 1
        if (count) record.sources[source] = count
        else delete record.sources[source]
        if (!Object.keys(record.sources).length) {
          record.live = false
          record.client.live = false
          generations.delete(sessionId)
          for (const requestId of [...record.client.submissions.keys()]) retire(model, requestId, { reason: 'failed' }, record.client)
          for (const cleanup of record.cleanups) cleanup()
          if (unresolvedAddresses.delete(sessionId)) { models.delete(sessionId); list.update(state => { const byId = { ...state.byId }; delete byId[sessionId]; return { ...state, byId, ids: state.ids.filter(id => id !== sessionId) } }) }
          if (gatewayOnly.delete(sessionId)) models.delete(sessionId)
        }
        publishRetention(sessionId)
      }
      const abortReady = () => rejectReady(signal?.reason)
      record.cleanups.add(release)
      signal?.addEventListener('abort', abortReady, { once: true })
      void ready.then(() => signal?.removeEventListener('abort', abortReady), () => signal?.removeEventListener('abort', abortReady))
      const reference: SessionReference = { sessionId, ready, release, [Symbol.dispose]: release,
        get binding() { if (released || !record.live) throw new Error('Session reference released'); return record.binding } }
      publishRetention(sessionId)
      return reference
  }

  let listRead: Promise<void> | undefined
  const sessions: ISessions = {
    list, searchResultLimit: 20,
    async create(input = {}) {
      await Promise.resolve()
      const sessionId = input.sessionId ?? id('session')
      const workspace = workspaceList.getSnapshot().items.find(item => item.workspaceId === input.workspaceId)
      if (input.workspaceId && !workspace) throw commandError('workspace/not-found', 'ワークスペースが見つかりません。', true)
      const cwd = workspace?.path ?? input.cwd ?? '/mock'
      const existing = models.get(sessionId)
      if (existing?.summary.origin === 'subagent') throw commandError('session/agent-busy', '子の会話を通常の会話として作成できません。', true)
      if (existing && existing.summary.cwd !== cwd) throw commandError('session/conflict', '会話のフォルダが一致しません。', true)
      if (!existing) kit.addSession({ id: sessionId, displayTitle: '新しいセッション', cwd, running: false, blank: true, updatedAt: Date.now() }, [])
      if (workspace) attachSession(workspace, sessionId)
      return sessionId
    },
    retain: (target, options) => retainTarget(target, options),
    async using(target, options, operation) {
      const reference = sessions.retain(target, options)
      try { await reference.ready; return await operation(reference) } finally { reference.release() }
    },
    retainInfo(sessionId) {
      let observer = retainObservers.get(sessionId)
      if (!observer) {
        const retainedBy = { ...generations.get(sessionId)?.sources }
        observer = observable<SessionRetainInfo>({ referenceCount: Object.values(retainedBy).reduce((sum, n) => sum + n, 0), retainedBy })
        retainObservers.set(sessionId, observer)
      }
      return observer
    },
    subagentAddress(sessionId) {
      const retained = generations.get(sessionId)?.binding.session.getSnapshot().subagent?.address
      if (retained) return retained
      for (const [parentSessionId, projection] of Object.entries(list.getSnapshot().projectionsBySession)) {
        const entry = projection.values.subagentCatalog?.find(row => row.id === sessionId)
        if (entry) return { parentSessionId, childSessionId: sessionId, mode: entry.mode }
      }
      return undefined
    },
    refreshProjections(sessionId) {
      const existing = projectionReads.get(sessionId)
      if (existing) return existing.promise
      const previous = list.getSnapshot().projectionsBySession[sessionId]
      if (previous?.state === 'ready') return Promise.resolve()
      readProjectionIds.add(sessionId)
      const initial = previous?.values ?? {}
      const controller = new AbortController()
      publishProjection(sessionId, initial, 'loading', null)
      const promise = Promise.resolve().then(async () => {
        try {
          const result = await (options.readProjections?.(sessionId, controller.signal)
            ?? Promise.resolve(success(models.has(sessionId) ? structuredClone(getModel(sessionId).hostProjections) : null)))
          if (controller.signal.aborted) return
          const current = list.getSnapshot().projectionsBySession[sessionId]?.values ?? {}
          if (!result.ok) { publishProjection(sessionId, current, 'error', result.error); return }
          const values = result.value === null
            ? current === initial ? {} : current
            : Object.fromEntries([...new Set([...Object.keys(current), ...Object.keys(result.value)])]
              .flatMap(key => current[key] !== initial[key] ? [[key, current[key]]] : Object.hasOwn(result.value!, key) ? [[key, result.value![key]]] : []))
          publishProjection(sessionId, values, 'ready', null)
        } catch (error) {
          if (controller.signal.aborted) return
          if (!error || typeof error !== 'object' || !('code' in error && 'message' in error && 'details' in error)) throw error
          publishProjection(sessionId, list.getSnapshot().projectionsBySession[sessionId]?.values ?? {}, 'error', error as RemoteFailure)
        } finally { if (projectionReads.get(sessionId)?.controller === controller) projectionReads.delete(sessionId) }
      })
      projectionReads.set(sessionId, { controller, promise })
      return promise
    },
    refresh() {
      if (listRead) return listRead
      listRead = Promise.resolve().then(() => {
        if (disposed) return
        list.update(state => {
          const rows = [...models.values()].filter(model => !unresolvedAddresses.has(model.summary.id) && !gatewayOnly.has(model.summary.id))
          const listed = rows.filter(model => model.summary.origin !== 'subagent' || model.agentAvailable)
          const known = new Set(listed.map(model => model.summary.id))
          const ids = [...state.ids.filter(id => known.has(id)), ...listed.map(model => model.summary.id).filter(id => !state.ids.includes(id))]
          return { ...state, ids, byId: Object.fromEntries(rows.map(model => [model.summary.id, model.summary])), phase: 'ready' }
        })
      }).finally(() => { listRead = undefined })
      return listRead
    },
    async search(query, signal) {
      if (signal.aborted) return failure('gateway/cancelled', '検索を取り消しました。')
      const normalized = query.trim()
      if (!validMockSearchQuery(normalized)) return failure('gateway/bad-request', '検索語を確認してください。')
      const matches = [...models.values()].flatMap((model) => {
        if (model.summary.cwd === undefined) return []
        const match = mockSearchMatch(model.records, normalized)
        return match ? [{ sessionId: model.summary.id, ...match, updatedAt: model.summary.updatedAt }] : []
      }).sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId))
      return success({ items: matches.slice(0, sessions.searchResultLimit).map(({ sessionId, snippet }) => ({ sessionId, snippet })), hasMore: matches.length > sessions.searchResultLimit })
    },
    async fork(input) {
      await Promise.resolve()
      if (input.atSeq !== undefined && (!Number.isSafeInteger(input.atSeq) || input.atSeq < 0 || Object.is(input.atSeq, -0))) throw new TypeError(`SessionSeq must be a non-negative safe integer, got ${String(input.atSeq)}`)
      const source = models.get(input.sessionId)
      if (!source) throw commandError('session/not-found', '会話が見つかりません。', true)
      let boundary = input.atSeq ?? [...source.records].reverse().find(event => event.type === 'turn/end')?.seq
      if (input.atSeq === undefined && boundary !== undefined) {
        for (const next of source.records.slice(boundary + 1)) {
          if (next.type === 'turn/start' || next.type === 'user/message' && next.surfaceOp === 'append' || next.type === 'agent/inbox/spliced') break
          boundary = next.seq
        }
      }
      if (boundary === undefined || source.records[boundary]?.seq !== boundary) throw commandError('session/fork-unavailable', '分岐できる記録がありません。', true)
      const sessionId = id('fork')
      const records = mockForkSeed(source.records, boundary)
      const title = source.summary.title
      kit.addSession({ id: sessionId, parentId: source.summary.id, cwd: source.summary.cwd, title, displayTitle: title ?? source.summary.displayTitle, running: false, blank: false, updatedAt: Date.now() }, records)
      let owner = source
      let workspace = workspaceList.getSnapshot().items.find(item => item.sessionIds.includes(owner.summary.id))
      const visited = new Set<string>()
      while (!workspace && owner.summary.origin === 'subagent' && owner.summary.parentId && !visited.has(owner.summary.id)) {
        visited.add(owner.summary.id)
        const parent = models.get(owner.summary.parentId)
        if (!parent) break
        owner = parent
        workspace = workspaceList.getSnapshot().items.find(item => item.sessionIds.includes(owner.summary.id))
      }
      if (workspace) attachSession(workspace, sessionId)
      input.onCreated?.(sessionId)
      if (input.increaseTitle && title) {
        const renamed = await sessions.using(sessionId, { source: 'm3e.mockFork' }, ref => ref.binding.session.rename(increasedForkTitle(title)))
        if (!renamed.ok) throw new Error(`fork child rename failed: ${renamed.error.code}: ${renamed.error.message}`)
      }
      return sessionId
    },
    scope: (sessionId) => generations.get(sessionId)?.binding.ctx,
    scopeOf(scope) { return typeof scope === 'object' && scope !== null ? scopeIds.get(scope) : undefined },
    sessionOf(scope) { const sessionId = sessions.scopeOf(scope); return sessionId && generations.get(sessionId)?.binding.ctx === scope ? generations.get(sessionId)?.binding.session : undefined },
    binding: (sessionId) => generations.get(sessionId)?.binding,
  }

  remote.$on = (event: string, handler: EventHandler) => {
    let listeners = handlers.get(event)
    if (!listeners) { listeners = new Set(); handlers.set(event, listeners) }
    listeners.add(handler)
    const waiting = [...startupEvents].filter((pending) => pending.event === event)
    if (waiting.length) {
      for (const pending of waiting) startupEvents.delete(pending)
      // Finish synchronous handler registration before taking the waterfall snapshot.
      queueMicrotask(() => { for (const pending of waiting) pending.deliver() })
    }
    return () => { listeners.delete(handler) }
  }

  const ctx: MockContext = {
    connection: {
      state: connectionState,
      reconnect() {
        connectionLifetime.abort()
        connectionLifetime = new AbortController()
        connectionState.set('connecting')
        void delay(400).then(() => {
          if (disposed) return
          for (const model of models.values()) replaceWindow(model)
          workspaceList.update((state) => ({ ...state }))
          for (const read of projectionReads.values()) read.controller.abort()
          projectionReads.clear()
          const targets = new Set(readProjectionIds)
          for (const record of generations.values()) {
            if (record.client.snapshot.getSnapshot().openState === 'open') targets.add(record.binding.sessionId)
            const parent = record.binding.session.getSnapshot().subagent?.address.parentSessionId
            if (parent) targets.add(parent)
          }
          for (const sessionId of Object.keys(list.getSnapshot().projectionsBySession)) publishProjection(sessionId, {}, 'idle', null)
          for (const sessionId of targets) void sessions.refreshProjections(sessionId)
          mockJobs.reconnect()
          connectionState.set('connected')
        })
      },
    },
    sessions, workspaces, remote,
    jobs: mockJobs.jobs,
    get mock() { return kit },
    dispose() {
      conversationSelection(sessions).dispose()
      for (const read of projectionReads.values()) read.controller.abort()
      projectionReads.clear()
      completionStatus(ctx).dispose()
      mockJobs.dispose()
      mockQuestions.dispose()
      connectionLifetime.abort()
      connectionState.set(undefined)
      disposed = true
      settingsReader = undefined
      for (const pending of startupEvents) pending.cancel()
      startupEvents.clear()
      for (const [timer, pending] of timers) { clearTimeout(timer); pending.resolve() }
      timers.clear()
      handlers.clear()
      recordListeners.clear()
      for (const [sessionId, record] of generations) {
        record.live = false
        record.client.live = false
        const model = models.get(sessionId)
        if (model) for (const requestId of [...record.client.submissions.keys()]) retire(model, requestId, { reason: 'failed' }, record.client)
        for (const cleanup of record.cleanups) cleanup()
        generations.delete(sessionId)
        publishRetention(sessionId)
      }
      for (const model of models.values()) {
        model.attempt = undefined
        for (const requestId of [...(generations.get(model.summary.id)?.client.submissions.keys() ?? [])]) retire(model, requestId, { reason: 'failed' })
      }
    },
  }

  const kit: MockKit = {
    appendEvent: (sessionId, type, data) => append(getModel(sessionId), type, data),
    onRecord(listener) { recordListeners.add(listener); return () => { recordListeners.delete(listener) } },
    remoteOf: <T>(namespace: string) => remote[namespace] as T | undefined,
    emitTimedQuestion: (sessionId, input) => mockQuestions.ask(sessionId, input),
    setConnectionState(state) {
      if (state !== 'connected') { connectionLifetime.abort(); connectionLifetime = new AbortController() }
      connectionState.set(state)
    },
    setAgentAvailable(sessionId, available) {
      const model = getModel(sessionId)
      model.agentAvailable = available
      if (!available) { settleAttempt(model); running(model, false) }
      if (model.summary.origin === 'subagent') list.update(state => ({ ...state, ids: available ? [...new Set([...state.ids, sessionId])] : state.ids.filter(id => id !== sessionId) }))
      for (const record of generations.values()) record.client.snapshot.update(state => state.subagent?.address.parentSessionId === sessionId ? { ...state, subagent: { ...state.subagent, parentAvailable: available } } : state)
    },
    getRecords(sessionId) { return structuredClone(getModel(sessionId).records) },
    setJobs: mockJobs.setRows,
    failJobRows: mockJobs.failRows,
    emitJobFrame: mockJobs.frame,
    addWorkspace(workspace) {
      if (workspaceList.getSnapshot().items.some((item) => item.workspaceId === workspace.workspaceId)) {
        console.error(`偽のワークスペースが重複しています: ${workspace.workspaceId}`)
        return
      }
      workspaceList.update((state) => ({ ...state, items: [...state.items, structuredClone(workspace)] }))
    },
    updateWorkspace(workspaceId, update) {
      const current = workspaceList.getSnapshot().items.find((item) => item.workspaceId === workspaceId)
      if (!current) {
        throw new Error(`偽のワークスペースが見つかりません: ${workspaceId}`)
      }
      const next = structuredClone(typeof update === 'function' ? update(structuredClone(current)) : update)
      workspaceList.update((state) => ({
        ...state,
        items: state.items.map((item) => item.workspaceId === workspaceId ? { ...item, ...next, workspaceId } : item),
      }))
    },
    addSession(summary, inputRecords, sessionOptions = {}) {
      const arriving = gatewayOnly.has(summary.id) && models.has(summary.id)
      if (models.has(summary.id) && !arriving) {
        console.error(`偽のセッションが重複しています: ${summary.id}`)
        return
      }
      const records = structuredClone([...inputRecords]).sort((a, b) => a.seq - b.seq)
      const start = Math.max(0, records.length - pageSize)
      const entries: SessionEventLikeEntry[] = records.slice(start).map((event) => ({ type: 'event', event }))
      const snapshot = observable<SessionSnapshot>({ sessionId: summary.id, pendingSubmissions: [], running: summary.running, subagent: null, removed: false, openState: 'open', openError: null, hasMore: start > 0, loadingOlder: false, promptError: null, blank: summary.blank, lastAgentError: null, promptAttempted: false, awaitingFirstTurn: false })
      const eventSource = observable<SessionEventWindow>({ entries, hasMore: start > 0, revision: 1, change: { kind: 'replace', entries } })
      const projections = new Map<string, MutableSnapshot<unknown>>()

      const initial = { summary: structuredClone({ ...summary, retainedBy: {} }), agentAvailable: sessionOptions.agentAvailable ?? true, records, start, snapshot, events: eventSource, projections, hostProjections: {}, acceptedRequests: new Set<string>() }
      const model: SessionModel = arriving ? getModel(summary.id) : initial
      if (arriving) {
        gatewayOnly.delete(summary.id)
        model.summary = initial.summary; model.records = records; model.start = start; model.agentAvailable = initial.agentAvailable
        model.snapshot.set(snapshot.getSnapshot())
      }
      models.set(summary.id, model)
      if (summary.parentId) seedChildDescriptor(summary.parentId, (models.get(summary.parentId)?.hostProjections.subagentCatalog ?? []) as readonly SubagentCatalogEntry[])
      for (const [key, value] of Object.entries(model.summary.projectionValues ?? {})) { model.hostProjections[key] = value; project(model, key).set(value) }
      if (!gatewayOnly.has(summary.id)) list.update((state) => ({ ...state, ids: summary.origin === 'subagent' && !model.agentAvailable ? state.ids : [...state.ids, summary.id], byId: { ...state.byId, [summary.id]: model.summary } }))
    },
    addRemote(namespace, impl) {
      if (Object.hasOwn(remote, namespace)) { console.warn(`偽の名前空間が重複しています: ${namespace}`); return }
      remote[namespace] = impl
    },
    async emit(event, payload, options = {}) {
      const additionalArgs = options.additionalArgs ?? []
      const args = payload === undefined && additionalArgs.length === 0 ? [] : [payload, ...additionalArgs]
      const input = payload as { agent?: string | { id?: string }; sessionId?: string } | null
      const sessionId = typeof input?.agent === 'string' ? input.agent : input?.agent?.id ?? input?.sessionId
      const owner = sessionId ? models.get(sessionId) : undefined
      if (options.afterMs !== undefined) await delay(options.afterMs, owner)
      if (disposed || (owner && !isActive(owner))) return undefined
      if (preparing && !handlers.get(event)?.size) {
        return new Promise((resolve) => {
          startupEvents.add({ event, owner, deliver: () => resolve(deliverEvent(event, args, sessionId, owner)), cancel: () => resolve(undefined) })
        })
      }
      return deliverEvent(event, args, sessionId, owner)
    },
    async streamAssistant(sessionId, text, streamOptions = {}) {
      const model = getModel(sessionId)
      settleAttempt(model)
      const boundary = [...model.records].reverse().find(event => event.type.startsWith('turn/'))
      const newTurn = boundary?.type !== 'turn/start'
      const turn = turnOf(model) + (newTurn ? 1 : 0)
      if (newTurn) append(model, 'turn/start', { turn })
      const stepBoundary = [...model.records].reverse().find(event => event.type.startsWith('step/'))
      const prior = stepBoundary?.data as { turn?: number; step?: number } | undefined
      const step = prior?.turn === turn ? (prior.step ?? 0) + (stepBoundary?.type === 'step/start' ? 0 : 1) : 1
      if (newTurn || stepBoundary?.type !== 'step/start') append(model, 'step/start', { turn, step })
      const used = streamOptions.model ?? { provider: 'mock', model: 'mock-model' }
      append(model, 'request/header', { header: { config: used }, reason: model.records.some(event => event.type === 'request/header') ? 'change' : 'initial' })
      const attempt = { id: id('attempt'), turn, step, chunks: [] as StreamChunk[], token: ++serial }
      model.attempt = attempt
      running(model, true)
      const chunk = (value: StreamChunk) => {
        if (!isActive(model) || model.attempt !== attempt) return false
        attempt.chunks.push(value)
        const entry: SessionEventLikeEntry = { type: 'transient', event: { type: 'assistant/live-chunk', seq: (model.records.at(-1)?.seq ?? -1) + attempt.chunks.length / (attempt.chunks.length + 1), time: Date.now(), data: { attemptId: attempt.id, turn: attempt.turn, step: attempt.step, chunk: value } } }
        publish(model, [...model.events.getSnapshot().entries, entry], { kind: 'append', entries: [entry] })
        return isActive(model) && model.attempt === attempt
      }
      if (!chunk({ type: 'block-start', index: 0, blockType: 'text' })) return
      for (const character of text) {
        await delay(streamOptions.chunkMs ?? 40, model)
        if (!isActive(model) || model.attempt !== attempt) return
        if (!chunk({ type: 'text-delta', index: 0, text: character })) return
      }
      if (!chunk({ type: 'block-end', index: 0, block: { type: 'text', text } })) return
      if (!chunk({ type: 'finish', reason: { kind: 'stop' } })) return
      const event: SessionWireEvent = { type: 'assistant/message', seq: (model.records.at(-1)?.seq ?? -1) + 1, time: Date.now(), surfaceOp: 'append', data: json({ turn: attempt.turn, step: attempt.step, message: { id: id('message'), role: 'assistant', source: { kind: 'model', provider: used.provider, model: used.model }, content: [{ type: 'text', text }] }, stream: attempt.chunks.map((value) => ({ type: 'chunk', time: Date.now(), chunk: value })) }) }
      model.records.push(event)
      settleAttempt(model, event)
      append(model, 'step/end', { turn: attempt.turn, step: attempt.step })
      append(model, 'turn/end', { turn: attempt.turn, reason: { kind: 'completed' } })
      running(model, false)
      advanceQueue(model)
    },
    setProjection(sessionId, key, value) {
      const model = getModel(sessionId)
      const next = structuredClone(value)
      model.hostProjections[key] = next
      if (key === 'subagentCatalog') seedChildDescriptor(sessionId, next as readonly SubagentCatalogEntry[])
      project(model, key).set(next)
      if (key === 'inbox') {
        const client = generations.get(sessionId)?.client
        if (client?.snapshot.getSnapshot().openState === 'open') for (const message of [...(next as InboxState)['next-turn'], ...(next as InboxState)['next-step']]) observeMessage(model, message, client, false)
      }
      model.summary = { ...model.summary, projectionValues: { ...model.summary.projectionValues, [key]: next } }
      list.update(state => ({ ...state, byId: { ...state.byId, [sessionId]: model.summary }, projectionsBySession: { ...state.projectionsBySession, [sessionId]: {
        ...(state.projectionsBySession[sessionId] ?? { state: 'idle', error: null }),
        values: { ...state.projectionsBySession[sessionId]?.values, [key]: next },
      } } }))
    },
    getProjection<T>(sessionId: string, key: string): T | undefined {
      return structuredClone(getModel(sessionId).projections.get(key)?.getSnapshot()) as T | undefined
    },
    updateProjection(sessionId, key, update) {
      kit.setProjection(sessionId, key, update(kit.getProjection(sessionId, key)))
    },
    registerSettingsReader(reader) {
      if (settingsReader) { console.warn('偽の設定の読み取り元が重複しています。'); return }
      if (!disposed) settingsReader = reader
    },
    getSettingsValue<T>(namespace: string): T | undefined {
      return structuredClone(settingsReader?.(namespace)) as T | undefined
    },
    setSessionState(sessionId, patch) {
      const model = getModel(sessionId)
      const next = structuredClone(patch)
      if (next.running === false) settleAttempt(model)
      model.snapshot.update((state) => ({ ...state, ...next, sessionId }))
      if (next.running !== undefined || next.blank !== undefined) {
        updateSummary(model, {
          ...(next.running === undefined ? {} : { running: next.running }),
          ...(next.blank === undefined ? {} : { blank: next.blank }),
        })
      }
    },
    removeSession(sessionId) {
      const model = models.get(sessionId)
      if (!model) return
      // This explicit fixture operation deletes durable data. Agent termination
      // uses setAgentAvailable(false), which preserves history and projections.
      // Invalidate the instance before waking async work or invoking retirement callbacks.
      project(model, 'inbox').set({ 'next-turn': [], 'next-step': [] })
      models.delete(sessionId)
      model.attempt = undefined
      cancelTimers(model)
      for (const pending of startupEvents) {
        if (pending.owner !== model) continue
        startupEvents.delete(pending)
        pending.cancel()
      }
      model.start = 0
      model.snapshot.update((state) => ({
        ...state, removed: true, running: false, loadingOlder: false,
        awaitingFirstTurn: false, hasMore: false, openState: 'error',
        openError: { code: 'session/not-found', message: '会話が見つかりません。', details: {} },
      }))
      model.events.update((window) => ({ entries: [], hasMore: false, revision: window.revision + 1, change: { kind: 'replace', entries: [] } }))
      workspaceList.update((state) => ({
        ...state,
        archivedSessionIds: state.archivedSessionIds.filter((id) => id !== sessionId),
        items: state.items.map((item) => ({ ...item, sessionIds: item.sessionIds.filter((id) => id !== sessionId) })),
      }))
      list.update((state) => {
        const byId = { ...state.byId }
        const projectionsBySession = { ...state.projectionsBySession }
        delete byId[sessionId]
        delete projectionsBySession[sessionId]
        if (model.summary.parentId) delete projectionsBySession[model.summary.parentId]
        return {
          ...state, ids: state.ids.filter((id) => id !== sessionId), byId, projectionsBySession,
        }
      })
      kit.setJobs(sessionId, [])
      for (const other of models.values()) {
        if (other.summary.parentId === sessionId) {
          const client = generations.get(other.summary.id)?.client
          client?.snapshot.update(state => ({ ...state, subagent: state.subagent ? { ...state.subagent, parentAvailable: false } : null }))
        }
      }
      for (const requestId of [...(generations.get(model.summary.id)?.client.submissions.keys() ?? [])]) retire(model, requestId, { reason: 'failed' })
    },
    removeWorkspace(workspaceId) {
      workspaceList.update((state) => ({ ...state, items: state.items.filter((item) => item.workspaceId !== workspaceId) }))
    },
    patch(path, impl) {
      const segments = path.split('.')
      if (segments.some((part) => ['__proto__', 'prototype', 'constructor'].includes(part))) throw new Error('差し替え先の名前が不正です。')
      let target = ctx as unknown as Record<string, unknown>
      for (const part of segments.slice(0, -1)) {
        const next = target[part]
        if (typeof next !== 'object' || next === null) throw new Error(`差し替え先が見つかりません: ${path}`)
        target = next as Record<string, unknown>
      }
      const last = segments.at(-1)
      if (!last || !Object.hasOwn(target, last)) throw new Error(`差し替え先が見つかりません: ${path}`)
      target[last] = impl
    },
    updateList(update) { const draft = structuredClone(list.getSnapshot()); list.set(update(draft) ?? draft) },
    scenario(name, setup) {
      if (scenarios.has(name)) { console.warn(`偽の状態が重複しています: ${name}`); return }
      scenarios.set(name, setup)
    },
    isScenario(...names) { return names.includes(selectedScenario) },
  }

  const mockQuestions = createMockQuestions({
    emit: (sessionId, questions, callId, signal) => kit.emit('user-questions/request', { agent: sessionId, questions, wait: { callId, timed: true }, signal }),
    get: sessionId => kit.getProjection(sessionId, 'userQuestions'),
    set: (sessionId, value) => kit.setProjection(sessionId, 'userQuestions', value),
    live: sessionId => models.get(sessionId)?.agentAvailable === true,
    connectionSignal: () => connectionLifetime.signal,
    queued: (sessionId, callId) => {
      const inbox = kit.getProjection<InboxState>(sessionId, 'inbox')
      return [...(inbox?.['next-step'] ?? []), ...(inbox?.['next-turn'] ?? [])].some(row => row.source.kind === 'user-question-reply' && (row.source as { callId?: string }).callId === callId)
    },
    enqueue: (sessionId, callId, questions, answer) => {
      const model = getModel(sessionId)
      const message = { id: id('message'), role: 'user' as const, source: { kind: 'user-question-reply', callId, outcome: 'answered' }, content: [{ type: 'text' as const, text: JSON.stringify({ kind: 'answer_to_pending_question', tool: 'ask_user_question', callId, questions, answers: answer.answers }) }] }
      kit.updateProjection<InboxState>(sessionId, 'inbox', inbox => ({ 'next-turn': inbox?.['next-turn'] ?? [], 'next-step': [...(inbox?.['next-step'] ?? []), message] }))
      void delay(0, model).then(() => { if (isActive(model) && !model.snapshot.getSnapshot().running) admitQuestionReplies(model) })
    },
  })
  remote.userQuestions = mockQuestions.remote
  completionStatus(ctx)
  connectionState.set('connected')
  for (const workspace of sharedWorkspaces) kit.addWorkspace(workspace)
  for (const session of sharedSessions) kit.addSession(session.summary, session.records)
  for (const session of sharedSessions) {
    kit.setProjection(session.summary.id, 'permissions', { currentValue: 'workspace-write' })
    kit.setProjection(session.summary.id, 'plan', { active: false, pending: false })
  }
  kit.setProjection(MOCK_IDS.sessions.approval, 'tokenUsage', { uncachedInputTokens: 11668, outputTokens: 812, cacheReadTokens: 0, cacheWriteTokens: 0 })
  const active = getModel(MOCK_IDS.sessions.approval)
  active.attempt = { id: 'mock-turn-2', turn: 2, step: 1, chunks: [{ type: 'block-start', index: 0, blockType: 'text' }], token: 0 }
  replaceWindow(active)
  kit.scenario('disconnected', () => connectionState.set('disconnected'))
  kit.scenario('reconnecting', () => connectionState.set('connecting'))
  kit.scenario('unconnected', () => kit.setConnectionState(undefined))
  kit.scenario('approval-demo', () => {
    void kit.emit('approval/request', { agent: MOCK_IDS.sessions.readme, toolName: 'bash', callId: 'mock-approval-demo', reason: 'テストを実行するため、今回の操作を承認してください。' }, { afterMs: 1000 }).catch(() => { /* Disposing an unanswered demo may abort the waterfall. */ })
  })
  for (const [index, extension] of (options.extensions ?? []).entries()) {
    try { extension.extendMock(kit) }
    catch (error) { console.error(`偽データの拡張に失敗しました: ${extension.source ?? `拡張 ${index + 1}`}`, error) }
  }
  if (selectedScenario) {
    const setup = scenarios.get(selectedScenario)
    if (setup) setup(kit)
    else console.warn(`偽の状態が見つかりません: ${selectedScenario}`)
  }
  preparing = false
  return ctx
}
