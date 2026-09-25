/** Browser-side copies of the DSH approval and question wire contracts. */
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

export interface AskUserQuestionOption {
  label: string
  description?: string
}

export interface AskUserQuestionIntent {
  kind: 'plan-review'
  approve: string
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
  signal?: AbortSignal
}

export interface AskUserQuestionRequestEvent {
  agent?: unknown
  questions: AskUserQuestionItem[]
  signal?: AbortSignal
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

  requestQuestion(sessionId: string, request: AskUserQuestionRequestEvent): Promise<AskUserQuestionAnswer> {
    return this.#request<AskUserQuestionAnswer>(
      (key, answer) => ({ key, kind: 'question', sessionId, deferred: false, items: request.questions, answer }),
      request.signal,
      questionAbortError,
    )
  }

  defer(key: string): void {
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
  sessions: { scopeOf(owner: unknown): string | undefined }
  remote: {
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
  let removeQuestion: (() => void) | void
  try {
    removeQuestion = ctx.remote.$on('user-questions/request', function(request, next) {
      const sessionId = ctx.sessions.scopeOf(this)
      return sessionId === undefined ? next() : store.requestQuestion(sessionId, request)
    })
  } catch (error) {
    removeApproval?.()
    throw error
  }
  let disposed = false
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    removeApproval?.()
    removeQuestion?.()
    store.dispose()
    registrations.delete(ctx)
  }
  registrations.set(ctx, { store, dispose })
  return dispose
}
