import type {
  AgentContext, BeginSubmissionInput, ContentBlock, DshContext, ImageAttachmentRef,
  IWorkspaces, ISessions, JsonValue, PendingSubmissionRetirement, RemoteResult,
  SessionBinding, SessionEventChange, SessionEventLikeEntry, SessionEventWindow,
  SessionFace, SessionListState, SessionSnapshot, SessionSummary, SessionWireEvent,
  StreamChunk, WorkspaceSnapshot, WorkspaceView,
} from '../services.ts'
import { observable, type MutableSnapshot } from './observable.ts'
import { imageAttachment, imageBase64, MOCK_IDS, sharedSessions, sharedWorkspaces } from './fixtures.ts'

type EventHandler = (this: AgentContext, payload: unknown, next: () => Promise<unknown>) => unknown
export interface MockKit {
  addWorkspace(workspace: WorkspaceView): void
  addSession(summary: SessionSummary, records: readonly SessionWireEvent[]): void
  addRemote(namespace: string, impl: unknown): void
  /** Use payload.agent or payload.sessionId. Initial setup events wait for their first handler. */
  emit(event: string, payload: unknown, options?: { afterMs?: number }): Promise<unknown>
  streamAssistant(sessionId: string, text: string, options?: { chunkMs?: number }): Promise<void>
  setProjection(sessionId: string, key: string, value: unknown): void
  /** Set lifecycle/error scenarios without changing a session's stable identity. */
  setSessionState(sessionId: string, patch: Partial<SessionSnapshot>): void
  removeSession(sessionId: string): void
  removeWorkspace(workspaceId: string): void
  patch(path: string, impl: unknown): void
  updateList(update: (state: SessionListState) => SessionListState | void): void
  scenario(name: string, setup: (kit: MockKit) => void): void
}
export type MockExtension = {
  /** Diagnostic origin supplied by the feature-module collector. */
  readonly source?: string
  extendMock(kit: MockKit): void
}
export interface MockOptions { scenario?: string; extensions?: readonly MockExtension[]; pageSize?: number }
export interface MockContext extends DshContext { readonly mock: MockKit; dispose(): void }

interface SessionModel {
  summary: SessionSummary
  snapshot: MutableSnapshot<SessionSnapshot>
  events: MutableSnapshot<SessionEventWindow>
  records: SessionWireEvent[]
  start: number
  projections: Map<string, MutableSnapshot<unknown>>
  submissions: Map<string, BeginSubmissionInput>
  binding: SessionBinding
  attempt?: { id: string; turn: number; step: number; chunks: StreamChunk[]; token: number }
}

const success = <T>(value: T): RemoteResult<T> => ({ ok: true, value })
const failure = (code: string, message: string, details: Readonly<Record<string, unknown>> = {}): RemoteResult<never> => ({ ok: false, error: { code, message, details } })
const accepted = () => success({ accepted: true as const })
const textOf = (content: readonly ContentBlock[]) => content.filter((block) => block.type === 'text').map((block) => block.text).join('\n')
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
  const attachments = new Map<string, { attachment: ImageAttachmentRef; data: Uint8Array }>([
    [imageAttachment.attachmentId, { attachment: imageAttachment, data: Uint8Array.from(atob(imageBase64), (character) => character.charCodeAt(0)) }],
  ])
  const remote: Record<string, unknown> = {}
  const pageSize = Math.max(1, options.pageSize ?? 100)
  const connectionState = observable<'connected' | 'disconnected' | 'connecting'>('connected')
  const list = observable<SessionListState>({ ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined })
  const workspaceList = observable<WorkspaceSnapshot>({ items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null })

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
    const scope = owner?.binding.ctx ?? { remote }
    const selected = [...(handlers.get(event) ?? [])]
    if (event !== 'approval/request' && event !== 'user-questions/request') {
      return Promise.all(selected.map((handler) => handler.call(scope, payload, async () => undefined)))
    }
    const invoke = async (index: number): Promise<unknown> => {
      const handler = selected[index]
      return handler ? handler.call(scope, payload, () => invoke(index + 1)) : undefined
    }
    return invoke(0)
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
    updateSummary(model, { running: value, blank: false, updatedAt: Date.now(), ...(value ? { completed: false } : {}) })
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
  function retire(model: SessionModel, requestId: string | undefined, retirement: PendingSubmissionRetirement) {
    if (!requestId) return
    const pending = model.submissions.get(requestId)
    if (!pending) return
    model.submissions.delete(requestId)
    model.snapshot.update((state) => ({ ...state, pendingSubmissions: state.pendingSubmissions.filter((row) => row.requestId !== requestId) }))
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
    const first = model.snapshot.getSnapshot().queue[0]
    if (!first) return
    model.snapshot.update((state) => ({ ...state, queue: state.queue.slice(1) }))
    beginTurn(model, first.content, first.rpcId)
    if (!isActive(model)) return
    void kit.streamAssistant(model.summary.id, '順番待ちのメッセージを受け取りました。', { chunkMs: 30 })
  }
  function project(model: SessionModel, key: string): MutableSnapshot<unknown> {
    let source = model.projections.get(key)
    if (!source) { source = observable<unknown>(undefined); model.projections.set(key, source) }
    return source
  }

  const workspaces: IWorkspaces = {
    list: workspaceList,
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
    async archiveSession(sessionId) {
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
    open(sessionId) {
      const model = models.get(sessionId)
      if (!model) return
      model.snapshot.update((state) => state.openState === 'error' ? state : { ...state, openState: 'open' })
      model.summary = { ...model.summary, completed: false }
      list.update((state) => ({ ...state, byId: { ...state.byId, [sessionId]: model.summary }, current: sessionId, currentAddress: model.snapshot.getSnapshot().subagent?.address }))
    },
    openSubagent(address) {
      const catalog = list.getSnapshot().subagentsByParent[address.parentSessionId]
      const entries = catalog?.entries
      const entry: unknown = Array.isArray(entries) ? entries.find((candidate: unknown) =>
        typeof candidate === 'object' && candidate !== null && 'id' in candidate && candidate.id === address.childSessionId) : undefined
      if (typeof entry !== 'object' || entry === null || !('kind' in entry) || entry.kind !== 'child'
        || !('mode' in entry) || (entry.mode !== 'one-shot' && entry.mode !== 'continuable') || entry.mode !== address.mode) {
        throw new Error('サブエージェントのカタログとアドレスが一致しません。')
      }
      const model = getModel(address.childSessionId)
      const selectedAddress = { ...address }
      model.snapshot.update((state) => ({ ...state, subagent: { address: selectedAddress, parentAvailable: catalog?.parentAvailable } }))
      sessions.open(address.childSessionId)
    },
    subagentAddress(sessionId) { return models.get(sessionId)?.snapshot.getSnapshot().subagent?.address },
    setSubagentCatalogOpen() { /* The in-memory catalog has no subscription cost. */ },
    async refreshSubagents() { list.update((state) => ({ ...state })) },
    clear() { list.update((state) => ({ ...state, current: undefined, currentAddress: undefined })) },
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
      return sessionId
    },
    scope: (sessionId) => models.get(sessionId)?.binding.ctx,
    scopeOf(scope) { for (const [sessionId, model] of models) if (model.binding.ctx === scope) return sessionId; return undefined },
    sessionOf(scope) { const sessionId = sessions.scopeOf(scope); return sessionId ? models.get(sessionId)?.binding.session : undefined },
    binding: (sessionId) => models.get(sessionId)?.binding,
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
          list.update((state) => ({ ...state }))
          connectionState.set('connected')
        })
      },
    },
    sessions, workspaces, remote,
    get mock() { return kit },
    dispose() {
      disposed = true
      for (const pending of startupEvents) pending.cancel()
      startupEvents.clear()
      for (const [timer, pending] of timers) { clearTimeout(timer); pending.resolve() }
      timers.clear()
      handlers.clear()
      for (const model of models.values()) {
        model.attempt = undefined
        for (const requestId of [...model.submissions.keys()]) retire(model, requestId, { reason: 'failed' })
      }
    },
  }

  const kit: MockKit = {
    addWorkspace(workspace) {
      if (workspaceList.getSnapshot().items.some((item) => item.workspaceId === workspace.workspaceId)) {
        console.error(`偽のワークスペースが重複しています: ${workspace.workspaceId}`)
        return
      }
      workspaceList.update((state) => ({ ...state, items: [...state.items, structuredClone(workspace)] }))
    },
    addSession(summary, inputRecords) {
      if (models.has(summary.id)) {
        console.error(`偽のセッションが重複しています: ${summary.id}`)
        return
      }
      const records = structuredClone([...inputRecords]).sort((a, b) => a.seq - b.seq)
      const start = Math.max(0, records.length - pageSize)
      const entries: SessionEventLikeEntry[] = records.slice(start).map((event) => ({ type: 'event', event }))
      const snapshot = observable<SessionSnapshot>({ sessionId: summary.id, queue: [], pendingSubmissions: [], running: summary.running, subagent: null, removed: false, openState: 'open', openError: null, hasMore: start > 0, loadingOlder: false, promptError: null, blank: summary.blank, lastAgentError: null, promptAttempted: false, awaitingFirstTurn: false })
      const eventSource = observable<SessionEventWindow>({ entries, hasMore: start > 0, revision: 1, change: { kind: 'replace', entries } })
      const projections = new Map<string, MutableSnapshot<unknown>>()
      const scope: AgentContext = { remote, sessionId: summary.id, agent: summary.id }
      const face: SessionFace = {
        sessionId: summary.id, getSnapshot: snapshot.getSnapshot, subscribe: snapshot.subscribe,
        projections: { faceOf: (key) => project(model, key) },
        beginSubmission(input) {
          const requestId = id('request')
          if (!isActive(model)) {
            input.onRetire?.({ reason: 'failed' })
            return { requestId, abandon() {} }
          }
          model.submissions.set(requestId, input)
          snapshot.update((state) => ({ ...state, pendingSubmissions: [...state.pendingSubmissions, { requestId, placement: state.running ? (input.mode === 'steer' ? 'steering' : 'queued') : 'transcript', time: Date.now(), text: input.text, attachments: input.attachments }] }))
          return { requestId, abandon: () => retire(model, requestId, { reason: 'failed' }) }
        },
        async prompt(parts, mode, signal, requestId) {
          if (!isActive(model)) return failure('session/not-found', '会話が見つかりません。')
          snapshot.update((state) => ({ ...state, promptAttempted: true, promptError: null }))
          if (signal?.aborted || connectionState.getSnapshot() !== 'connected') {
            const result = failure(signal?.aborted ? 'rpc/aborted' : 'connection/disconnected', signal?.aborted ? '送信を取り消しました。' : '接続が切れています。')
            if (!result.ok) snapshot.update((state) => ({ ...state, promptError: { op: 'send', error: result.error } }))
            retire(model, requestId, { reason: 'failed' })
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
            retire(model, requestId, { reason: 'failed' })
            return result
          }
          if (snapshot.getSnapshot().running && mode === 'queue') {
            const itemId = id('queue')
            const text = textOf(content)
            snapshot.update((state) => ({ ...state, queue: [...state.queue, { id: itemId, messageId: id('message'), placement: 'queued', ...(requestId ? { rpcId: requestId } : {}), content, preview: text, text }] }))
          } else {
            if (snapshot.getSnapshot().running) { settleAttempt(model); append(model, 'turn/end', { turn: turnOf(model), reason: { kind: 'aborted', reason: { kind: 'user' } } }) }
            beginTurn(model, content, requestId)
            if (isActive(model)) void kit.streamAssistant(summary.id, 'メッセージを受け取りました。これは偽データによる応答です。', { chunkMs: 30 })
          }
          retire(model, requestId, { reason: 'observed', attachments: content.flatMap((block) => block.type === 'image' || block.type === 'file' ? [block.attachment] : []) })
          return accepted()
        },
        async updateQueue(itemId, action) {
          if (!isActive(model)) return failure('session/not-found', '会話が見つかりません。')
          const item = snapshot.getSnapshot().queue.find((row) => row.id === itemId)
          if (!item) return failure('session/queue-item-not-found', '順番待ちのメッセージが見つかりません。', { itemId })
          if (action.kind === 'edit') snapshot.update((state) => ({ ...state, queue: state.queue.map((row) => row.id === itemId ? { ...row, content: action.content, text: textOf(action.content), preview: textOf(action.content) } : row) }))
          else {
            snapshot.update((state) => ({ ...state, queue: state.queue.filter((row) => row.id !== itemId) }))
            if (action.kind === 'steer') {
              settleAttempt(model)
              append(model, 'turn/end', { turn: turnOf(model), reason: { kind: 'aborted', reason: { kind: 'user' } } })
              beginTurn(model, item.content, item.rpcId)
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
          if (!isActive(model) || model.start === 0 || snapshot.getSnapshot().loadingOlder) return
          snapshot.update((state) => ({ ...state, loadingOlder: true }))
          await Promise.resolve()
          if (!isActive(model)) return
          const previousStart = model.start
          model.start = Math.max(0, model.start - pageSize)
          const older: SessionEventLikeEntry[] = model.records.slice(model.start, previousStart).map((event) => ({ type: 'event', event }))
          publish(model, [...older, ...eventSource.getSnapshot().entries], { kind: 'prepend', entries: older })
          snapshot.update((state) => ({ ...state, hasMore: model.start > 0, loadingOlder: false }))
        },
        async loadThrough(seq) { while (isActive(model) && model.start > 0 && (model.records[model.start]?.seq ?? 0) > seq) await face.loadOlder() },
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
      const model: SessionModel = { summary: structuredClone(summary), records, start, snapshot, events: eventSource, projections, submissions: new Map(), binding: { sessionId: summary.id, session: face, eventSource, ctx: scope } }
      models.set(summary.id, model)
      for (const [key, value] of Object.entries(summary.projectionValues ?? {})) project(model, key).set(value)
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
      updateSummary(model, { completed: list.getSnapshot().current !== sessionId })
      advanceQueue(model)
    },
    setProjection(sessionId, key, value) {
      const model = getModel(sessionId)
      project(model, key).set(value)
      updateSummary(model, { projectionValues: { ...model.summary.projectionValues, [key]: value } })
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
        ...state, removed: true, running: false, queue: [], loadingOlder: false,
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
        const jobsBySession = { ...state.jobsBySession }
        const subagentsByParent = { ...state.subagentsByParent }
        delete byId[sessionId]
        delete jobsBySession[sessionId]
        delete subagentsByParent[sessionId]
        if (model.summary.parentId) delete subagentsByParent[model.summary.parentId]
        const selectedAddressRemoved = state.currentAddress?.parentSessionId === sessionId || state.currentAddress?.childSessionId === sessionId
        return {
          ...state, ids: state.ids.filter((id) => id !== sessionId), byId, jobsBySession, subagentsByParent,
          current: state.current === sessionId || selectedAddressRemoved ? undefined : state.current,
          currentAddress: selectedAddressRemoved ? undefined : state.currentAddress,
        }
      })
      for (const other of models.values()) {
        if (other.summary.parentId === sessionId) other.snapshot.update((state) => ({ ...state, subagent: state.subagent ? { ...state.subagent, parentAvailable: false } : null }))
      }
      for (const requestId of [...model.submissions.keys()]) retire(model, requestId, { reason: 'failed' })
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
  }

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
  if (options.scenario) {
    const setup = scenarios.get(options.scenario)
    if (setup) setup(kit)
    else console.warn(`偽の状態が見つかりません: ${options.scenario}`)
  }
  preparing = false
  return ctx
}
