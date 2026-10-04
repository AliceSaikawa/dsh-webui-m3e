import type {
  AgentContext, BeginSubmissionInput, ContentBlock, DshContext, ImageAttachmentRef,
  IWorkspaces, ISessions, JsonValue, PendingSubmissionRetirement, RemoteResult,
  SessionBinding, SessionEventChange, SessionEventLikeEntry, SessionEventWindow,
  SessionFace, SessionListState, SessionSnapshot, SessionSummary, SessionWireEvent,
  StreamChunk, WorkspaceSnapshot, WorkspaceView, SessionReference, SessionRetainInfo,
  SessionTarget, SessionJob, InboxState, ObservableSnapshot, RemoteFailure,
} from '../services.ts'
import { createMockJobs, type JobFrame } from './jobs.ts'
import { observable, type MutableSnapshot } from './observable.ts'
import { completionStatus } from '../completion-status.ts'
import { conversationSelection } from '../conversation-selection.ts'
import { imageAttachment, imageBase64, MOCK_IDS, sharedSessions, sharedWorkspaces } from './fixtures.ts'

type EventHandler = (this: AgentContext, payload: unknown, next: () => Promise<unknown>) => unknown
export interface MockKit {
  addWorkspace(workspace: WorkspaceView): void
  /** Update an existing workspace in place; unknown ids throw and identity stays fixed. */
  updateWorkspace(workspaceId: string, update: Partial<Omit<WorkspaceView, 'workspaceId'>> | ((current: WorkspaceView) => Partial<Omit<WorkspaceView, 'workspaceId'>>)): void
  addSession(summary: Omit<SessionSummary, 'retainedBy'> & Partial<Pick<SessionSummary, 'retainedBy'>>, records: readonly SessionWireEvent[]): void
  getRecords(sessionId: string): readonly SessionWireEvent[]
  setJobs(sessionId: string, rows: readonly SessionJob[]): void
  failJobRows(sessionId: string): void
  emitJobFrame(jobId: string, frame: JobFrame): void
  addRemote(namespace: string, impl: unknown): void
  /** Use payload.agent or payload.sessionId. Initial setup events wait for their first handler. */
  emit(event: string, payload: unknown, options?: { afterMs?: number }): Promise<unknown>
  streamAssistant(sessionId: string, text: string, options?: { chunkMs?: number }): Promise<void>
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
export interface MockOptions { scenario?: string; extensions?: readonly MockExtension[]; pageSize?: number; readJobRows?: (id: string) => Promise<RemoteResult<readonly SessionJob[]>>; readProjections?: (id: string, signal: AbortSignal) => Promise<RemoteResult<Record<string, unknown> | null>> }
export interface MockContext extends DshContext { readonly mock: MockKit; dispose(): void }

interface SessionModel {
  summary: SessionSummary
  snapshot: MutableSnapshot<SessionSnapshot>
  events: MutableSnapshot<SessionEventWindow>
  records: SessionWireEvent[]
  start: number
  hostProjections: Record<string, unknown>
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
  const connectionState = observable<'connected' | 'disconnected' | 'connecting'>('connected')
  const list = observable<SessionListState>({ ids: [], byId: {}, phase: 'ready', projectionsBySession: {} })
  const workspaceList = observable<WorkspaceSnapshot>({ items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null })
  const mockJobs = createMockJobs(options.readJobRows)
  const hostJobs = mockJobs.host
  const projectionReads = new Map<string, { controller: AbortController; promise: Promise<void> }>()
  const readProjectionIds = new Set<string>()
  const unresolvedAddresses = new Set<string>()
  const retainObservers = new Map<string, MutableSnapshot<SessionRetainInfo>>()
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
    const record = { client, binding: undefined as unknown as SessionBinding, sources: {} as Record<string, number>, live: true, cleanups: new Set<() => void>() }
    const guard = () => { if (!record.live) throw new Error('Session generation is disposed') }
    const watch = <T>(source: ObservableSnapshot<T>): ObservableSnapshot<T> => ({
      getSnapshot: source.getSnapshot,
      subscribe(listener) {
        guard()
        const unsubscribe = source.subscribe(listener)
        const release = () => { unsubscribe(); record.cleanups.delete(release) }
        record.cleanups.add(release)
        return release
      },
    })
    const overrides = new Map<PropertyKey, unknown>()
    const projectionFaces = new Map<string, ObservableSnapshot<unknown>>()
    const source = client.face
    const face = new Proxy(source, { get(target, key) {
      if (key === 'subscribe') return watch(source).subscribe
      if (key === 'projections') return { faceOf: (name: string) => { guard(); let face = projectionFaces.get(name); if (!face) { face = watch(source.projections.faceOf(name)); projectionFaces.set(name, face) }; return face } }
      const value = overrides.has(key) ? overrides.get(key) : Reflect.get(target, key)
      return typeof value === 'function' && key !== 'getSnapshot' ? (...args: unknown[]) => { guard(); return value.apply(target, args) } : value
    }, set(_target, key, value) { guard(); overrides.set(key, value); return true } })
    record.binding = { sessionId, session: face, ctx: { remote, sessionId, agent: sessionId }, eventSource: watch(client.events) }
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
      client.events.set({ entries, change, hasMore: isActive(model) && client.start > 0, revision: current.revision + 1 })
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
  async function deliverEvent(event: string, payload: unknown, sessionId: string | undefined, owner: SessionModel | undefined): Promise<unknown> {
    if (disposed || (sessionId && (!owner || !isActive(owner)))) return undefined
    const reference = owner ? sessions.retain(owner.summary.id, { source: 'm3e.mockGateway' }) : undefined
    const scope = reference?.binding.ctx ?? { remote }
    const selected = [...(handlers.get(event) ?? [])]
    try {
    if (event !== 'approval/request' && event !== 'user-questions/request') {
      return await Promise.all(selected.map((handler) => handler.call(scope, payload, async () => undefined)))
    }
    const invoke = async (index: number): Promise<unknown> => {
      const handler = selected[index]
      return handler ? handler.call(scope, payload, () => invoke(index + 1)) : undefined
    }
    return await invoke(0)
    } finally { reference?.release() }
  }
  const getModel = (sessionId: string): SessionModel => {
    const model = models.get(sessionId)
    if (!model) throw new Error(`偽のセッションが見つかりません: ${sessionId}`)
    return model
  }
  function updateSummary(model: SessionModel, patch: Partial<SessionSummary>) {
    if (!isActive(model)) return
    model.summary = { ...model.summary, ...patch }
    list.update((state) => ({ ...state, byId: { ...state.byId, [model.summary.id]: model.summary } }))
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
  function beginTurn(model: SessionModel, content: readonly ContentBlock[], requestId?: string) {
    const turn = turnOf(model) + 1
    append(model, 'turn/start', { turn })
    append(model, 'user/message', { id: id('message'), role: 'user', content, source: { kind: 'user' }, ...(requestId ? { requestId } : {}) })
    append(model, 'step/start', { turn, step: 1 })
    running(model, true)
  }
  function retire(model: SessionModel, requestId: string | undefined, retirement: PendingSubmissionRetirement, client = generations.get(model.summary.id)?.client) {
    if (!requestId || !client) return
    const pending = client.submissions.get(requestId)
    if (!pending) return
    client.submissions.delete(requestId)
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
    const inbox = project(model, 'inbox').getSnapshot() as InboxState | undefined
    const first = inbox?.['next-turn'][0]
    if (!first) return
    kit.setProjection(model.summary.id, 'inbox', { ...inbox, 'next-turn': inbox!['next-turn'].slice(1) })
    beginTurn(model, first.content, first.source.rpcId)
    if (!isActive(model)) return
    void kit.streamAssistant(model.summary.id, '順番待ちのメッセージを受け取りました。', { chunkMs: 30 })
  }
  function project(model: SessionModel, key: string): MutableSnapshot<unknown> {
    let source = model.projections.get(key)
    if (!source) { source = observable<unknown>(undefined); model.projections.set(key, source) }
    return source
  }


  function makeClient(model: SessionModel) {
    const summary = model.summary
    const start = Math.max(0, model.records.length - pageSize)
    const snapshot = observable<SessionSnapshot>({ ...model.snapshot.getSnapshot(), pendingSubmissions: [], promptAttempted: false, promptError: null, awaitingFirstTurn: false, loadingOlder: false, hasMore: start > 0 })
    const entries: SessionEventLikeEntry[] = [...model.records.slice(start).map(event => ({ type: 'event' as const, event })), ...model.events.getSnapshot().entries.filter(entry => entry.type === 'transient')]
    const eventSource = observable<SessionEventWindow>({ entries, hasMore: start > 0, revision: 1, change: { kind: 'replace', entries } })
    const client = { start, snapshot, events: eventSource, submissions: new Map<string, BeginSubmissionInput>(), live: true, face: undefined as unknown as SessionFace }
    const retireSubmission = (requestId: string | undefined, retirement: PendingSubmissionRetirement) => retire(model, requestId, retirement, client)
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
        snapshot.update((state) => ({ ...state, pendingSubmissions: [...state.pendingSubmissions, { requestId, placement: state.running ? (input.mode === 'steer' ? 'steering' : 'queued') : 'transcript', time: Date.now(), text: input.text, attachments: input.attachments }] }))
        return { requestId, abandon: () => retireSubmission(requestId, { reason: 'failed' }) }
      },
      async prompt(parts, mode, signal, requestId) {
        if (!isActive(model)) return failure('session/not-found', '会話が見つかりません。')
        snapshot.update((state) => ({ ...state, promptAttempted: true, promptError: null }))
        if (signal?.aborted || connectionState.getSnapshot() !== 'connected') {
          const result = failure(signal?.aborted ? 'rpc/aborted' : 'connection/disconnected', signal?.aborted ? '送信を取り消しました。' : '接続が切れています。')
          if (!result.ok) snapshot.update((state) => ({ ...state, promptError: { op: 'send', error: result.error } }))
          retireSubmission(requestId, { reason: 'failed' })
          return result
        }
        let content: ContentBlock[]
        try {
          content = parts.map((part) => {
            if (part.type === 'text') return { type: 'text', text: part.text }
            if (part.type === 'image') {
              const data = Uint8Array.from(atob(part.data), (character) => character.charCodeAt(0))
              const attachment = { ...imageAttachment, attachmentId: id('image'), bytes: data.length, mediaType: part.mediaType, ...(part.name ? { name: part.name } : {}) }
              attachments.set(attachment.attachmentId, { attachment, data })
              return { type: 'image', attachment }
            }
            return { type: 'file', attachment: { attachmentId: part.receiptId, name: '添付ファイル', bytes: 0 } }
          })
        } catch {
          const result = failure('attachment/invalid-data', '画像のデータを読み込めませんでした。')
          if (!result.ok) snapshot.update((state) => ({ ...state, promptError: { op: 'send', error: result.error } }))
          retireSubmission(requestId, { reason: 'failed' })
          return result
        }
        if (snapshot.getSnapshot().running && mode === 'queue') {
          kit.updateProjection<InboxState>(summary.id, 'inbox', inbox => ({ 'next-step': inbox?.['next-step'] ?? [], 'next-turn': [...(inbox?.['next-turn'] ?? []), { id: id('message'), role: 'user', source: { kind: 'user', ...(requestId ? { rpcId: requestId } : {}) }, content }] }))
        } else {
          if (snapshot.getSnapshot().running) { settleAttempt(model); append(model, 'turn/end', { turn: turnOf(model), reason: { kind: 'aborted', reason: { kind: 'user' } } }) }
          beginTurn(model, content, requestId)
          if (isActive(model)) void kit.streamAssistant(summary.id, 'メッセージを受け取りました。これは偽データによる応答です。', { chunkMs: 30 })
        }
        retireSubmission(requestId, { reason: 'observed', attachments: content.flatMap((block) => block.type === 'image' || block.type === 'file' ? [block.attachment] : []) })
        return accepted()
      },
      async updateQueue(itemId, action) {
        if (!isActive(model)) return failure('session/not-found', '会話が見つかりません。')
        const inbox = project(model, 'inbox').getSnapshot() as InboxState | undefined
        if (action.kind === 'edit') {
          if (action.content.some(block => block.type !== 'text')) return failure('session/attachment-invalid', 'テキストだけを編集できます。', { reason: 'QUEUE_EDIT_NON_TEXT' })
          if (!action.content.some(block => block.text.trim())) return failure('gateway/bad-request', '空白以外のメッセージを入力してください。')
        }
        const target = inbox?.['next-turn'].some(row => row.id === itemId) ? 'next-turn' : 'next-step'
        const item = inbox?.[target].find(row => row.id === itemId)
        if (!item) return failure('session/queue-item-not-found', '順番待ちのメッセージが見つかりません。', { itemId })
        if (action.kind === 'steer' && (target !== 'next-turn' || !model.snapshot.getSnapshot().running)) return failure('session/steer-unavailable', '今は割り込めません。', { itemId })
        if (action.kind === 'edit') kit.setProjection(summary.id, 'inbox', { ...inbox, [target]: inbox![target].map(row => row.id === itemId ? { ...row, content: action.content } : row) })
        else {
          kit.setProjection(summary.id, 'inbox', { ...inbox, [target]: inbox![target].filter(row => row.id !== itemId) })
          if (action.kind === 'steer') {
            settleAttempt(model)
            append(model, 'turn/end', { turn: turnOf(model), reason: { kind: 'aborted', reason: { kind: 'user' } } })
            beginTurn(model, item.content, item.source.rpcId)
            if (isActive(model)) void kit.streamAssistant(summary.id, '割り込みのメッセージを受け取りました。', { chunkMs: 30 })
          }
        }
        return accepted()
      },
      async cancel() {
        if (!isActive(model)) return failure('session/not-found', '会話が見つかりません。')
        settleAttempt(model)
        if (snapshot.getSnapshot().running) append(model, 'turn/end', { turn: turnOf(model), reason: { kind: 'aborted', reason: { kind: 'user' } } })
        running(model, false)
        void delay(0, model).then(() => { if (isActive(model)) advanceQueue(model) })
        return accepted()
      },
      async rename(title) {
        if (!isActive(model)) return failure('session/not-found', '会話が見つかりません。')
        const normalized = title.trim()
        if (!normalized) return failure('session/title-invalid', '題名を入力してください。', { sessionId: model.summary.id })
        updateSummary(model, { title: normalized, displayTitle: normalized })
        const event = append(model, 'session/title', { title: normalized })
        return success({ title: normalized, seq: event.seq })
      },
      async loadOlder() {
        if (!isActive(model) || client.start === 0 || snapshot.getSnapshot().loadingOlder) return
        snapshot.update((state) => ({ ...state, loadingOlder: true }))
        await Promise.resolve()
        if (!isActive(model) || !client.live) return
        const previousStart = client.start
        client.start = Math.max(0, client.start - pageSize)
        const older: SessionEventLikeEntry[] = model.records.slice(client.start, previousStart).map((event) => ({ type: 'event', event }))
        eventSource.update(window => ({ entries: [...older, ...window.entries], change: { kind: 'prepend', entries: older }, hasMore: client.start > 0, revision: window.revision + 1 }))
        snapshot.update((state) => ({ ...state, hasMore: client.start > 0, loadingOlder: false }))
      },
      async loadThrough(seq) { while (isActive(model) && client.start > 0 && (model.records[client.start]?.seq ?? 0) > seq) await face.loadOlder() },
      async command(line) {
        if (!isActive(model)) return failure('session/not-found', '会話が見つかりません。')
        const [name, ...args] = line.trim().replace(/^\//, '').split(/\s+/)
        if (!name || !['permission', 'plan', 'model', 'help', 'clear'].includes(name)) return success({ matched: false })
        const commandId = id('command')
        const event = append(model, 'command/run', { commandId, name, args: args.join(' '), source: 'user' })
        if (name === 'plan') kit.setProjection(summary.id, 'plan', { active: args[0] !== 'off', pending: false })
        if (name === 'permission' && args[0]) kit.setProjection(summary.id, 'permissions', { ...(project(model, 'permissions').getSnapshot() as object), currentValue: args[0] })
        append(model, 'command/done', { commandId, kind: 'success', text: `/${name} を実行しました`, sourceEventSeq: event.seq })
        return success({ matched: true })
      },
      async readAttachment(attachmentId) {
        if (!isActive(model)) return failure('session/not-found', '会話が見つかりません。')
        const value = attachments.get(attachmentId)
        return value ? success({ attachment: { ...value.attachment }, data: value.data.slice() }) : failure('attachment/not-found', '画像が見つかりません。')
      },
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

  const workspaces: IWorkspaces = {
    list: workspaceList,
    async initializeDefault() { return undefined },
    async unarchiveSession(sessionId) { workspaceList.update(state => ({ ...state, archivedSessionIds: state.archivedSessionIds.filter(id => id !== sessionId) })) },
    async pinSession(id) { workspaceList.update(state => ({ ...state, pinnedSessionIds: [id, ...state.pinnedSessionIds.filter(value => value !== id)] })) },
    async unpinSession(id) { workspaceList.update(state => ({ ...state, pinnedSessionIds: state.pinnedSessionIds.filter(value => value !== id) })) },
    async create({ path }) {
      const previous = workspaceList.getSnapshot().items.find((item) => item.path === path)
      if (previous) return previous
      const now = new Date().toISOString()
      const workspace: WorkspaceView = { workspaceId: id('workspace'), path, title: path.split('/').filter(Boolean).at(-1) ?? 'ワークスペース', sessionIds: [], createdAt: now, updatedAt: now }
      kit.addWorkspace(workspace)
      return workspace
    },
    async rename(workspaceId, title) {
      const previous = workspaceList.getSnapshot().items.find((item) => item.workspaceId === workspaceId)
      if (!previous) throw new Error('ワークスペースが見つかりません。')
      const next = { ...previous, title: title.trim() || previous.title, updatedAt: new Date().toISOString() }
      workspaceList.update((state) => ({ ...state, items: state.items.map((item) => item.workspaceId === workspaceId ? next : item) }))
      return next
    },
    async delete(workspaceId) { kit.removeWorkspace(workspaceId) },
    async insertBefore(workspaceId, beforeWorkspaceId) {
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
      const model = getModel(sessionId)
      if ((model.snapshot.getSnapshot().running || hostJobs.get(sessionId)?.some(row => row.status === 'running' || row.status === 'stopping')) && !options?.stopActivity) {
        throw { rpcError: { code: 'workspace/session-active', message: 'Session has running activity', details: { sessionId } } }
      }
      if (options?.stopActivity) running(model, false)
      workspaceList.update((state) => ({ ...state, archivedSessionIds: [...new Set([...state.archivedSessionIds, sessionId])] }))
    },
    async insertSessionBefore(workspaceId, sessionId, beforeSessionId) {
      const workspace = workspaceList.getSnapshot().items.find((item) => item.workspaceId === workspaceId)
      if (!workspace) throw new Error('ワークスペースが見つかりません。')
      if (sessionId === beforeSessionId && workspace.sessionIds.includes(sessionId)) return workspace
      const sessionIds = workspace.sessionIds.filter((value) => value !== sessionId)
      const index = sessionIds.indexOf(beforeSessionId ?? '')
      sessionIds.splice(index < 0 ? sessionIds.length : index, 0, sessionId)
      const next = { ...workspace, sessionIds, updatedAt: new Date().toISOString() }
      workspaceList.update((state) => ({ ...state, archivedSessionIds: state.archivedSessionIds.filter((value) => value !== sessionId), items: state.items.map((item) => item.workspaceId === workspaceId ? next : { ...item, sessionIds: item.sessionIds.filter((value) => value !== sessionId) }) }))
      return next
    },
  }

  const sessions: ISessions = {
    list, searchResultLimit: 20,
    async create(input = {}) {
      const sessionId = input.sessionId ?? id('session')
      if (models.has(sessionId)) return sessionId
      const workspace = workspaceList.getSnapshot().items.find((item) => item.workspaceId === input.workspaceId)
      kit.addSession({ id: sessionId, displayTitle: '新しいセッション', cwd: input.cwd ?? workspace?.path, running: false, blank: true, updatedAt: Date.now() }, [])
      if (workspace) await workspaces.insertSessionBefore(workspace.workspaceId, sessionId)
      return sessionId
    },
    retain(target: SessionTarget, { source, signal }) {
      signal?.throwIfAborted()
      if (disposed) throw new Error('Session Controller is disposed')
      const sessionId = typeof target === 'string' ? target : target.childSessionId
      const address = typeof target === 'string' ? sessions.subagentAddress(target) : target
      if (typeof target === 'string' && !generations.has(sessionId) && !list.getSnapshot().byId[sessionId] && !address) throw new Error(`sessions.retain: unknown session ${sessionId}`)
      // A durable address is admitted locally; missing children fail at open, as on the Host.
      if (!models.has(sessionId)) {
        unresolvedAddresses.add(sessionId)
        kit.addSession({ id: sessionId, displayTitle: sessionId, running: false, blank: true, updatedAt: 0, origin: 'subagent', parentId: address?.parentSessionId }, [])
        kit.setSessionState(sessionId, { openState: 'error', openError: { code: 'session/not-found', message: '会話が見つかりません。', details: {} } })
      }
      const model = getModel(sessionId)
      if (address) model.snapshot.update(state => ({ ...state, subagent: { address, parentAvailable: models.has(address.parentSessionId) } }))
      const record = generation(sessionId)
      record.sources[source] = (record.sources[source] ?? 0) + 1
      let released = false
      let rejectReady: (error: unknown) => void = () => {}
      const ready = new Promise<SessionBinding>((resolve, reject) => {
        rejectReady = reject
        queueMicrotask(() => { if (!released && record.live) { record.cleanups.delete(cancelReady); resolve(record.binding) } })
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
          if (unresolvedAddresses.delete(sessionId)) kit.removeSession(sessionId)
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
    },
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
    async refresh() { list.update((state) => ({ ...state, phase: 'ready' })) },
    async search(query, signal) {
      if (signal.aborted) return failure('rpc/aborted', '検索を取り消しました。')
      const needle = query.toLocaleLowerCase()
      const matches = [...models.values()].flatMap((model) => {
        const contents = model.records.map((event) => JSON.stringify(event.data)).join('\n')
        const haystack = `${model.summary.displayTitle}\n${contents}`
        const index = haystack.toLocaleLowerCase().indexOf(needle)
        return index < 0 ? [] : [{ sessionId: model.summary.id, snippet: haystack.slice(Math.max(0, index - 15), index + 100) }]
      })
      return success({ items: matches.slice(0, sessions.searchResultLimit), hasMore: matches.length > sessions.searchResultLimit })
    },
    async fork(input) {
      const source = getModel(input.sessionId)
      const sessionId = id('fork')
      const title = input.increaseTitle === false ? source.summary.displayTitle : `${source.summary.displayTitle}（分岐）`
      kit.addSession({ ...source.summary, id: sessionId, title, displayTitle: title, running: false, updatedAt: Date.now() }, source.records.filter((event) => input.atSeq === undefined || event.seq <= input.atSeq))
      const workspace = workspaceList.getSnapshot().items.find((item) => item.sessionIds.includes(input.sessionId))
      if (workspace) await workspaces.insertSessionBefore(workspace.workspaceId, sessionId)
      input.onCreated?.(sessionId)
      return sessionId
    },
    scope: (sessionId) => generations.get(sessionId)?.binding.ctx,
    scopeOf(scope) { for (const [sessionId, record] of generations) if (record.binding.ctx === scope) return sessionId; return undefined },
    sessionOf(scope) { const sessionId = sessions.scopeOf(scope); return sessionId ? generations.get(sessionId)?.binding.session : undefined },
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
        connectionState.set('connecting')
        void delay(400).then(() => {
          if (disposed) return
          for (const model of models.values()) replaceWindow(model)
          workspaceList.update((state) => ({ ...state }))
          for (const read of projectionReads.values()) read.controller.abort()
          projectionReads.clear()
          const targets = new Set(readProjectionIds)
          for (const record of generations.values()) {
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
      disposed = true
      settingsReader = undefined
      for (const pending of startupEvents) pending.cancel()
      startupEvents.clear()
      for (const [timer, pending] of timers) { clearTimeout(timer); pending.resolve() }
      timers.clear()
      handlers.clear()
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
    addSession(summary, inputRecords) {
      if (models.has(summary.id)) {
        console.error(`偽のセッションが重複しています: ${summary.id}`)
        return
      }
      const records = structuredClone([...inputRecords]).sort((a, b) => a.seq - b.seq)
      const start = Math.max(0, records.length - pageSize)
      const entries: SessionEventLikeEntry[] = records.slice(start).map((event) => ({ type: 'event', event }))
      const snapshot = observable<SessionSnapshot>({ sessionId: summary.id, pendingSubmissions: [], running: summary.running, subagent: null, removed: false, openState: 'open', openError: null, hasMore: start > 0, loadingOlder: false, promptError: null, blank: summary.blank, lastAgentError: null, promptAttempted: false, awaitingFirstTurn: false })
      const eventSource = observable<SessionEventWindow>({ entries, hasMore: start > 0, revision: 1, change: { kind: 'replace', entries } })
      const projections = new Map<string, MutableSnapshot<unknown>>()

      const model: SessionModel = { summary: structuredClone({ ...summary, retainedBy: {} }), records, start, snapshot, events: eventSource, projections, hostProjections: {} }
      models.set(summary.id, model)
      for (const [key, value] of Object.entries(model.summary.projectionValues ?? {})) { model.hostProjections[key] = value; project(model, key).set(value) }
      list.update((state) => ({ ...state, ids: [...state.ids, summary.id], byId: { ...state.byId, [summary.id]: model.summary } }))
    },
    addRemote(namespace, impl) {
      if (Object.hasOwn(remote, namespace)) { console.warn(`偽の名前空間が重複しています: ${namespace}`); return }
      remote[namespace] = impl
    },
    async emit(event, payload, options = {}) {
      const input = payload as { agent?: string | { id?: string }; sessionId?: string } | null
      const sessionId = typeof input?.agent === 'string' ? input.agent : input?.agent?.id ?? input?.sessionId
      const owner = sessionId ? models.get(sessionId) : undefined
      if (options.afterMs !== undefined) await delay(options.afterMs, owner)
      if (disposed || (sessionId && (!owner || !isActive(owner)))) return undefined
      if (preparing && !handlers.get(event)?.size) {
        return new Promise((resolve) => {
          startupEvents.add({ event, owner, deliver: () => resolve(deliverEvent(event, payload, sessionId, owner)), cancel: () => resolve(undefined) })
        })
      }
      return deliverEvent(event, payload, sessionId, owner)
    },
    async streamAssistant(sessionId, text, streamOptions = {}) {
      const model = getModel(sessionId)
      settleAttempt(model)
      const attempt = { id: id('attempt'), turn: turnOf(model) || 1, step: 1, chunks: [] as StreamChunk[], token: ++serial }
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
      const event: SessionWireEvent = { type: 'assistant/message', seq: (model.records.at(-1)?.seq ?? -1) + 1, time: Date.now(), surfaceOp: 'append', data: json({ turn: attempt.turn, step: attempt.step, message: { id: id('message'), role: 'assistant', source: { kind: 'model', provider: 'mock', model: 'mock-model' }, content: [{ type: 'text', text }] }, stream: attempt.chunks.map((value) => ({ type: 'chunk', time: Date.now(), chunk: value })) }) }
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
      project(model, key).set(next)
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
        if (other.summary.parentId === sessionId) other.snapshot.update((state) => ({ ...state, subagent: state.subagent ? { ...state.subagent, parentAvailable: false } : null }))
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

  completionStatus(ctx)
  for (const workspace of sharedWorkspaces) kit.addWorkspace(workspace)
  for (const session of sharedSessions) kit.addSession(session.summary, session.records)
  for (const session of sharedSessions) {
    kit.setProjection(session.summary.id, 'permissions', { options: [{ value: 'workspace-write', name: 'ワークスペース書込' }], currentValue: 'workspace-write' })
    kit.setProjection(session.summary.id, 'plan', { active: false, pending: false })
  }
  kit.setProjection(MOCK_IDS.sessions.approval, 'tokenUsage', { uncachedInputTokens: 11668, outputTokens: 812, cacheReadTokens: 0, cacheWriteTokens: 0 })
  const active = getModel(MOCK_IDS.sessions.approval)
  active.attempt = { id: 'mock-turn-3', turn: 3, step: 1, chunks: [{ type: 'block-start', index: 0, blockType: 'text' }], token: 0 }
  replaceWindow(active)
  kit.scenario('disconnected', () => connectionState.set('disconnected'))
  kit.scenario('reconnecting', () => connectionState.set('connecting'))
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
