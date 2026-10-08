import type { ISessions, RemoteResult, SessionBinding } from './services.ts'

/** Browser-side copies of the DSH approval and question wire contracts. */
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

export interface AskUserQuestionOption {
  label: string
  description?: string
}

export interface AskUserQuestionIntent {
  kind: 'plan-review'
  approve: string
  callId?: string
}

export interface AskUserQuestionItem {
  id: string
  question: string
  detail?: string
  header?: string
  options?: AskUserQuestionOption[]
  multiSelect?: boolean
  intent?: AskUserQuestionIntent
}

export interface AskUserQuestionAnswerItem {
  id: string
  selected: string[]
  custom?: string
}

export interface AskUserQuestionAnswer {
  answers: AskUserQuestionAnswerItem[]
}

export interface ApprovalRequestEvent {
  agent?: unknown
  toolName: string
  callId?: string
  reason?: string
  displayReason?: { en: string; [locale: string]: string }
  signal?: AbortSignal
}

export interface AskUserQuestionRequestEvent {
  agent?: unknown
  questions: AskUserQuestionItem[]
  signal?: AbortSignal
  wait?: { callId: string; timed?: boolean }
}

export interface UserQuestionProjection {
  active: readonly { callId: string; questions: readonly AskUserQuestionItem[]; state: 'open' | 'continued' }[]
  settled: readonly { callId: string; answers: readonly AskUserQuestionAnswerItem[] }[]
}

export interface UserQuestionsRemote {
  attachWait(sessionId: string, callId: string, signal?: AbortSignal): AsyncIterable<{ remainingMs: number }> & { dispose(): void }
  answer(sessionId: string, callId: string, answer: AskUserQuestionAnswer): Promise<RemoteResult<boolean>>
}

const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
function questionItems(value: unknown): AskUserQuestionItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(value => {
    const item = record(value)
    if (typeof item.id !== 'string' || typeof item.question !== 'string') return []
    const intent = record(item.intent)
    return [{ id: item.id, question: item.question,
      ...(typeof item.detail === 'string' ? { detail: item.detail } : {}),
      ...(typeof item.header === 'string' ? { header: item.header } : {}),
      ...(typeof item.multiSelect === 'boolean' ? { multiSelect: item.multiSelect } : {}),
      ...(Array.isArray(item.options) ? { options: item.options.flatMap(value => {
        const option = record(value)
        return typeof option.label === 'string' ? [{ label: option.label, ...(typeof option.description === 'string' ? { description: option.description } : {}) }] : []
      }) } : {}),
      ...(intent.kind === 'plan-review' && typeof intent.approve === 'string' ? { intent: { kind: 'plan-review' as const, approve: intent.approve } } : {}),
    }]
  })
}

interface QuestionCard {
  pending: PendingQuestion
  projectedActive?: boolean
  live?: { answer(value: AskUserQuestionAnswer): void; cancel(): void; setVisible(visible: boolean): void }
  visible: number
  rpc?: (answer: AskUserQuestionAnswer) => Promise<boolean>
  submitting: boolean
}

interface PendingBase {
  readonly key: string
  readonly sessionId: string
  /** Local presentation state only; deferring never answers the Host waterfall. */
  readonly deferred: boolean
}

export interface PendingApproval extends PendingBase {
  readonly kind: 'approval'
  readonly toolName: string
  readonly callId?: string
  readonly reason?: string
  answer(outcome: ApprovalOutcome): Promise<void>
}

export interface PendingQuestion extends PendingBase {
  readonly kind: 'question'
  readonly items: AskUserQuestionItem[]
  readonly callId?: string
  answer(answer: AskUserQuestionAnswer): Promise<void>
}

export type PendingInteraction = PendingApproval | PendingQuestion

/** A plan remains a question on the wire, including in a mixed question batch. */
export function isPlanReview(pending: PendingInteraction): pending is PendingQuestion {
  return pending.kind === 'question' && pending.items.some((item) => item.intent?.kind === 'plan-review')
}

function questionAbortError(): Error {
  return Object.assign(new Error('回答の前に質問が取り消されました。'), {
    name: 'UserQuestionError',
    code: 'ASK_ABORTED',
  })
}

/** Observable request queue. No React or DSH package imports are required. */
export class InteractionStore {
  #pending: PendingInteraction[] = []
  #listeners = new Set<() => void>()
  #cancel = new Map<string, (reason?: unknown) => void>()
  #nextKey = 0
  #questions = new Map<string, QuestionCard>()

  getSnapshot = (): PendingInteraction[] => this.#pending

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  requestApproval(sessionId: string, request: ApprovalRequestEvent): Promise<ApprovalOutcome> {
    return this.#request<ApprovalOutcome>(
      (key, answer) => ({
        key, kind: 'approval', sessionId, deferred: false,
        toolName: request.toolName, callId: request.callId, reason: request.reason, answer,
      }),
      request.signal,
      () => request.signal?.reason ?? new Error('承認の要求が取り消されました。'),
    )
  }

  requestQuestion(sessionId: string, request: AskUserQuestionRequestEvent, remainingMs?: number): Promise<AskUserQuestionAnswer> {
    if (request.wait?.timed) return this.#timedQuestion(sessionId, request, remainingMs)
    return this.#request<AskUserQuestionAnswer>(
      (key, answer) => ({ key, kind: 'question', sessionId, deferred: false, items: request.questions, answer }),
      request.signal,
      questionAbortError,
    )
  }

  #questionCard(sessionId: string, callId: string, questions: readonly AskUserQuestionItem[]): QuestionCard {
    const key = `question:${JSON.stringify([sessionId, callId])}`
    const existing = this.#questions.get(key)
    if (existing) return existing
    const card: QuestionCard = {
      submitting: false, visible: 0,
      pending: { key, kind: 'question', sessionId, callId, deferred: false, items: [...questions],
        answer: async (value) => {
          if (this.#questions.get(key) !== card || card.submitting) throw new Error('この要求への回答はすでに終了しています。')
          if (card.live) { card.live.answer(value); return }
          if (!card.rpc) throw questionAbortError()
          card.submitting = true
          try {
            if (!await card.rpc(value)) throw questionAbortError()
            // Host projections own removal, including a queued reply cancelled
            // before this RPC returns. Its replacement can have the same key.
          } finally { card.submitting = false }
        },
      },
    }
    this.#questions.set(key, card)
    this.#pending = [...this.#pending, card.pending]
    this.#notify()
    return card
  }

  #removeQuestion(key: string): void {
    if (!this.#questions.delete(key)) return
    this.#pending = this.#pending.filter(pending => pending.key !== key)
    this.#notify()
  }

  #timedQuestion(sessionId: string, request: AskUserQuestionRequestEvent, remainingMs?: number): Promise<AskUserQuestionAnswer> {
    if (request.signal?.aborted) return Promise.reject(questionAbortError())
    const card = this.#questionCard(sessionId, request.wait!.callId, request.questions)
    card.live?.cancel()
    return new Promise((resolve, reject) => {
      let remaining = remainingMs
      let deadline: number | undefined
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (settle: () => void) => {
        if (card.live !== live) return
        clearTimeout(timer)
        request.signal?.removeEventListener('abort', live.cancel)
        card.live = undefined
        settle()
      }
      const live = {
        setVisible: (visible: boolean) => {
          if (visible) {
            if (deadline !== undefined) remaining = Math.max(0, deadline - Date.now())
            clearTimeout(timer); timer = undefined; deadline = undefined
          } else if (remaining !== undefined && deadline === undefined) {
            deadline = Date.now() + remaining
            timer = setTimeout(() => finish(() => reject(Object.assign(questionAbortError(), { code: 'ASK_TIMED_OUT' }))), remaining)
          }
        },
        answer: (answer: AskUserQuestionAnswer) => finish(() => resolve(answer)),
        // The projection, not cancellation of the foreground waterfall, owns
        // the timed card's lifetime. A timeout can still be answered via RPC.
        cancel: () => finish(() => {
          if (card.projectedActive === false) this.#removeQuestion(card.pending.key)
          reject(questionAbortError())
        }),
      }
      card.live = live
      request.signal?.addEventListener('abort', live.cancel, { once: true })
      live.setVisible(card.visible > 0)
    })
  }

  /** The existing answer sheet is the focus seat; hidden/queued cards keep counting down. */
  presentQuestion(key: string): () => void {
    const card = this.#questions.get(key)
    if (!card) return () => {}
    card.visible++
    card.live?.setVisible(true)
    return () => {
      card.visible--
      if (card.visible === 0) card.live?.setVisible(false)
    }
  }

  /** Mirror the same continued/queued/settled states as the stock question UI. */
  syncQuestions(sessionId: string, projection: UserQuestionProjection | undefined, inbox: unknown,
    answer: (callId: string, value: AskUserQuestionAnswer) => Promise<boolean>): void {
    const queues = record(inbox)
    const queued = new Set(['next-step', 'next-turn'].flatMap(key => Array.isArray(queues[key]) ? queues[key] : [])
      .flatMap(message => { const source = record(record(message).source); return source.kind === 'user-question-reply' && typeof source.callId === 'string' ? [source.callId] : [] }))
    const rows = record(projection).active
    const active = (Array.isArray(rows) ? rows : []).flatMap(value => {
      const row = record(value)
      if (typeof row.callId !== 'string' || (row.state !== 'open' && row.state !== 'continued')) return []
      const questions = questionItems(row.questions)
      return questions.length && (row.state !== 'continued' || !queued.has(row.callId)) ? [{ callId: row.callId, state: row.state, questions }] : []
    })
    for (const row of active) if (row.state === 'continued') {
      const card = this.#questionCard(sessionId, row.callId, row.questions)
      card.rpc = value => answer(row.callId, value)
    }
    for (const [key, card] of this.#questions) {
      if (card.pending.sessionId !== sessionId) continue
      card.projectedActive = active.some(row => row.callId === card.pending.callId)
      if (!card.live && !card.projectedActive) this.#removeQuestion(key)
    }
  }

  forgetQuestions(sessionId: string): void {
    for (const [key, card] of this.#questions) if (card.pending.sessionId === sessionId && !card.live) this.#removeQuestion(key)
  }

  defer(key: string): void {
    this.#questions.get(key)?.live?.setVisible(false)
    this.#replace((pending) => pending.key === key && !pending.deferred ? { ...pending, deferred: true } : pending)
  }

  /** Call once when entering a conversation, not when switching its chat/trace tab. */
  resetDeferred(sessionId: string): void {
    this.#replace((pending) => pending.sessionId === sessionId && pending.deferred
      ? { ...pending, deferred: false }
      : pending)
  }

  dispose(): void {
    for (const cancel of [...this.#cancel.values()]) cancel()
    for (const [key, card] of this.#questions) { card.live?.cancel(); this.#removeQuestion(key) }
  }

  #replace(update: (pending: PendingInteraction) => PendingInteraction): void {
    const next = this.#pending.map(update)
    if (next.every((pending, index) => pending === this.#pending[index])) return
    this.#pending = next
    this.#notify()
  }

  #notify(): void {
    for (const listener of this.#listeners) listener()
  }

  #request<T>(
    makePending: (key: string, answer: (value: T) => Promise<void>) => PendingInteraction,
    signal: AbortSignal | undefined,
    abortReason: () => unknown,
  ): Promise<T> {
    const key = `interaction:${++this.#nextKey}`
    return new Promise<T>((resolve, reject) => {
      let settled = false
      const finish = (settle: () => void): boolean => {
        if (settled) return false
        settled = true
        signal?.removeEventListener('abort', onAbort)
        this.#cancel.delete(key)
        const next = this.#pending.filter((pending) => pending.key !== key)
        const removed = next.length !== this.#pending.length
        this.#pending = removed ? next : this.#pending
        settle()
        if (removed) this.#notify()
        return true
      }
      const onAbort = (): void => { finish(() => reject(abortReason())) }
      const answer = (value: T): Promise<void> => {
        if (!finish(() => resolve(value))) return Promise.reject(new Error('この要求への回答はすでに終了しています。'))
        return Promise.resolve()
      }
      if (signal?.aborted) {
        onAbort()
        return
      }
      this.#cancel.set(key, onAbort)
      this.#pending = [...this.#pending, makePending(key, answer)]
      signal?.addEventListener('abort', onAbort, { once: true })
      this.#notify()
    })
  }
}

export type ApprovalHandler = (
  this: unknown, request: ApprovalRequestEvent, next: () => Promise<ApprovalOutcome>,
) => Promise<ApprovalOutcome>

export type QuestionHandler = (
  this: unknown, request: AskUserQuestionRequestEvent, next: () => Promise<AskUserQuestionAnswer>,
) => Promise<AskUserQuestionAnswer>

/** The request's receiver is an Agent scope, resolved by sessions.scopeOf(this). */
export interface InteractionContext {
  sessions: Pick<ISessions, 'scopeOf'> & Partial<Pick<ISessions, 'list' | 'binding'>>
  remote: {
    userQuestions?: UserQuestionsRemote
    $on(event: 'approval/request', handler: ApprovalHandler): (() => void) | void
    $on(event: 'user-questions/request', handler: QuestionHandler): (() => void) | void
  }
}

const registrations = new WeakMap<InteractionContext, { store: InteractionStore; dispose: () => void }>()

/** Bind each waterfall exactly once for a live root context. */
export function registerInteractionHandlers(ctx: InteractionContext, store: InteractionStore): () => void {
  const registered = registrations.get(ctx)
  if (registered !== undefined) {
    if (registered.store !== store) throw new Error('この接続には対応待ちの受け取りがすでに登録されています。')
    return registered.dispose
  }
  const removeApproval = ctx.remote.$on('approval/request', function(request, next) {
    const sessionId = ctx.sessions.scopeOf(this)
    return sessionId === undefined ? next() : store.requestApproval(sessionId, request)
  })
  let removeQuestion: (() => void) | void = undefined
  let stopProjections: (() => void) | undefined
  const claims = new Set<AbortController>()
  try {
    removeQuestion = ctx.remote.$on('user-questions/request', async function(request, next) {
      const sessionId = ctx.sessions.scopeOf(this)
      if (sessionId === undefined) return next()
      if (!request.wait?.timed) return store.requestQuestion(sessionId, request)
      if (!ctx.remote.userQuestions) return next()
      const lifetime = new AbortController()
      const signal = request.signal ? AbortSignal.any([request.signal, lifetime.signal]) : lifetime.signal
      const claim = ctx.remote.userQuestions.attachWait(sessionId, request.wait.callId, signal)
      claims.add(lifetime)
      let ended: Promise<never> | undefined
      const release = () => { lifetime.abort(); claim.dispose(); claims.delete(lifetime) }
      try {
        const iterator = claim[Symbol.asyncIterator]()
        const opening = await iterator.next()
        if (opening.done) return await next()
        ended = iterator.next().then(() => { throw questionAbortError() }).catch(error => { lifetime.abort(); throw error })
        return await Promise.race([store.requestQuestion(sessionId, { ...request, signal }, opening.value.remainingMs), ended])
      } finally {
        // The answer still has to cross the waterfall transport. Releasing
        // here races it with the Host deadline. Let Host settlement end the
        // stream first, just as the stock UI does.
        if (ended) void Promise.allSettled([ended]).then(release)
        else release()
      }
    })
    stopProjections = observeQuestions(ctx, store)
  } catch (error) {
    removeApproval?.()
    removeQuestion?.()
    stopProjections?.()
    for (const claim of claims) claim.abort()
    store.dispose()
    throw error
  }
  let disposed = false
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    removeApproval?.()
    removeQuestion?.()
    stopProjections?.()
    for (const claim of claims) claim.abort()
    store.dispose()
    registrations.delete(ctx)
  }
  registrations.set(ctx, { store, dispose })
  return dispose
}

/** Only bound Sessions have live projection faces; replace subscriptions on a new generation. */
function observeQuestions(ctx: InteractionContext, store: InteractionStore): () => void {
  const sessions = ctx.sessions
  const observed = new Map<string, { binding: SessionBinding; stop(): void }>()
  const reconcile = () => {
    const summaries = sessions.list?.getSnapshot().byId ?? {}
    for (const pending of store.getSnapshot()) if (pending.kind === 'question' && pending.callId && !summaries[pending.sessionId]) store.forgetQuestions(pending.sessionId)
    const answerFor = (id: string) => async (callId: string, answer: AskUserQuestionAnswer) => {
      const result = await ctx.remote.userQuestions!.answer(id, callId, answer)
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    }
    const bound = new Map(Object.keys(summaries).flatMap(id => {
      const binding = sessions.binding?.(id)
      return binding ? [[id, binding] as const] : []
    }))
    for (const [id, entry] of observed) if (bound.get(id) !== entry.binding) {
      entry.stop(); observed.delete(id)
      if (!summaries[id]) store.forgetQuestions(id)
    }
    // The list also carries Host projections, including unbound Sessions.
    // Keep continued cards answerable on the inbox after leaving a conversation.
    for (const [id, summary] of Object.entries(summaries)) if (!bound.has(id)) {
      const values = summary.projectionValues
      store.syncQuestions(id, values?.userQuestions as UserQuestionProjection | undefined, values?.inbox, answerFor(id))
    }
    for (const [id, binding] of bound) {
      if (observed.has(id)) continue
      const questions = binding.session.projections.faceOf('userQuestions')
      const inbox = binding.session.projections.faceOf('inbox')
      const update = () => store.syncQuestions(id, questions.getSnapshot() as UserQuestionProjection | undefined, inbox.getSnapshot(), answerFor(id))
      const stopQuestions = questions.subscribe(update)
      let stopInbox: () => void
      try { stopInbox = inbox.subscribe(update) } catch (error) { stopQuestions(); throw error }
      observed.set(id, { binding, stop: () => { stopQuestions(); stopInbox() } })
      update()
    }
  }
  let stopList: (() => void) | undefined
  const dispose = () => { stopList?.(); for (const entry of observed.values()) entry.stop(); observed.clear() }
  try { reconcile(); stopList = sessions.list?.subscribe(reconcile) } catch (error) { dispose(); throw error }
  return dispose
}
