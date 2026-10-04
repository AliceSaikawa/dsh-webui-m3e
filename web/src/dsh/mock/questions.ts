import type { RemoteResult } from '../services.ts'

export interface MockQuestion { id: string; question: string; detail?: string; header?: string; options?: { label: string; description?: string }[]; multiSelect?: boolean; intent?: { kind: 'plan-review'; approve: string; callId?: string } }
export interface MockQuestionAnswer { answers: { id: string; selected: string[]; custom?: string }[] }
export interface MockTimedQuestion { callId: string; questions: MockQuestion[]; timeoutMs: number; signal?: AbortSignal }
export interface MockQuestionProjection {
  active: { callId: string; questions: MockQuestion[]; state: 'open' | 'continued' }[]
  settled: { callId: string; answers: MockQuestionAnswer['answers'] }[]
}
export interface MockWaitStream extends AsyncIterable<{ remainingMs: number }> { dispose(): void }
export interface MockUserQuestionsRemote {
  attachWait(sessionId: string, callId: string, signal: AbortSignal): MockWaitStream
  answer(sessionId: string, callId: string, answer: MockQuestionAnswer): Promise<RemoteResult<boolean>>
}
const questionError = (code: string) => Object.assign(new Error(code), { name: 'UserQuestionError', code })
interface Wait { controller: AbortController; deadline: number; claims: Set<() => void>; timer?: ReturnType<typeof setTimeout>; schedule(): void }

/** Business wait ownership from dsh-user-questions. Feature fixtures own tool records. */
export function createMockQuestions(hooks: {
  emit(sessionId: string, questions: MockQuestion[], callId: string, signal: AbortSignal): Promise<unknown>
  get(sessionId: string): MockQuestionProjection | undefined
  set(sessionId: string, projection: MockQuestionProjection): void
  live(sessionId: string): boolean
  connectionSignal(): AbortSignal
  admit(sessionId: string, callId: string, questions: MockQuestion[], answer: MockQuestionAnswer): void
}) {
  const waits = new Map<string, Map<string, Wait>>()
  const replies = new Set<string>()
  const replyTimers = new Set<ReturnType<typeof setTimeout>>()
  const projection = (sessionId: string) => hooks.get(sessionId) ?? { active: [], settled: [] }
  function close(wait: Wait, code = 'ASK_ABORTED') { clearTimeout(wait.timer); wait.controller.abort(questionError(code)) }
  function settle(sessionId: string, callId: string, answer: MockQuestionAnswer) {
    const current = projection(sessionId)
    hooks.set(sessionId, { active: current.active.filter(q => q.callId !== callId), settled: [...current.settled, { callId, answers: structuredClone(answer.answers) }] })
  }
  const remote: MockUserQuestionsRemote = {
    attachWait(sessionId, callId, signal) {
      const lifetime = new AbortController()
      const claimSignal = AbortSignal.any([signal, lifetime.signal, hooks.connectionSignal()])
      const stream = (async function* () {
        if (!hooks.live(sessionId)) throw questionError('CALLER_NOT_LIVE')
        const wait = waits.get(sessionId)?.get(callId)
        if (!wait || claimSignal.aborted || wait.controller.signal.aborted) return
        if (!wait.claims.size && Date.now() >= wait.deadline) { close(wait, 'ASK_TIMED_OUT'); return }
        let resolve: () => void = () => {}
        const ended = new Promise<void>(done => { resolve = done })
        const release = () => {
          if (!wait.claims.delete(release)) return
          claimSignal.removeEventListener('abort', release)
          wait.controller.signal.removeEventListener('abort', release)
          resolve(); wait.schedule()
        }
        wait.claims.add(release)
        claimSignal.addEventListener('abort', release, { once: true })
        wait.controller.signal.addEventListener('abort', release, { once: true })
        wait.schedule()
        try { yield { remainingMs: Math.max(0, wait.deadline - Date.now()) }; await ended }
        finally { release() }
      })()
      return { [Symbol.asyncIterator]: () => stream, dispose() { lifetime.abort(); void stream.return(undefined) } }
    },
    async answer(sessionId, callId, answer) {
      const failure = (code: string): RemoteResult<never> => ({ ok: false, error: { code: 'gateway/internal', message: code, details: {} } })
      if (!hooks.live(sessionId)) return failure('CALLER_NOT_LIVE')
      const question = projection(sessionId).active.find(q => q.callId === callId && q.state === 'continued')
      if (!question) return { ok: true, value: false }
      const key = JSON.stringify([sessionId, callId])
      if (replies.has(key)) return failure('REPLY_QUEUED')
      const ids = new Set(answer.answers.map(item => item.id))
      if (ids.size !== answer.answers.length || question.questions.length !== ids.size || question.questions.some(item => !ids.has(item.id))) return failure('BAD_ANSWER')
      replies.add(key)
      const timer = setTimeout(() => {
        replyTimers.delete(timer); replies.delete(key)
        if (!hooks.live(sessionId)) return
        hooks.admit(sessionId, callId, question.questions, answer)
        settle(sessionId, callId, answer)
      }, 0)
      replyTimers.add(timer)
      return { ok: true, value: true }
    },
  }
  return {
    remote,
    async ask(sessionId: string, input: MockTimedQuestion): Promise<MockQuestionAnswer | { pending: true; callId: string }> {
      if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 2147483647) throw questionError('BAD_TIMEOUT')
      if (!hooks.live(sessionId)) throw questionError('CALLER_NOT_LIVE')
      const calls = waits.get(sessionId) ?? new Map<string, Wait>()
      if (calls.has(input.callId)) throw questionError('DUPLICATE_WAIT')
      const wait: Wait = { controller: new AbortController(), deadline: Date.now() + input.timeoutMs, claims: new Set(), schedule() {
        clearTimeout(wait.timer)
        if (!wait.controller.signal.aborted && !wait.claims.size) wait.timer = setTimeout(() => close(wait, 'ASK_TIMED_OUT'), Math.max(0, wait.deadline - Date.now()))
      } }
      calls.set(input.callId, wait); waits.set(sessionId, calls)
      const cancel = () => close(wait)
      input.signal?.addEventListener('abort', cancel, { once: true })
      if (input.signal?.aborted) cancel()
      const current = projection(sessionId)
      hooks.set(sessionId, { ...current, active: [...current.active, { callId: input.callId, questions: structuredClone(input.questions), state: 'open' }] })
      wait.schedule()
      let onAbort: () => void = () => {}
      const aborted = new Promise<never>((_, reject) => { onAbort = () => reject(wait.controller.signal.reason); wait.controller.signal.addEventListener('abort', onAbort, { once: true }); if (wait.controller.signal.aborted) onAbort() })
      try {
        const result = await Promise.race([aborted, hooks.emit(sessionId, input.questions, input.callId, wait.controller.signal).then(value => value === undefined ? aborted : value)]) as MockQuestionAnswer
        settle(sessionId, input.callId, result)
        return result
      } catch (error) {
        const reason = wait.controller.signal.aborted ? wait.controller.signal.reason : error
        if ((reason as { code?: string })?.code !== 'ASK_TIMED_OUT') throw reason
        const current = projection(sessionId)
        hooks.set(sessionId, { ...current, active: current.active.map(q => q.callId === input.callId ? { ...q, state: 'continued' } : q) })
        return { pending: true, callId: input.callId }
      } finally {
        wait.controller.signal.removeEventListener('abort', onAbort)
        input.signal?.removeEventListener('abort', cancel)
        close(wait); calls.delete(input.callId)
        if (!calls.size) waits.delete(sessionId)
      }
    },
    dispose() { for (const calls of waits.values()) for (const wait of calls.values()) close(wait); waits.clear(); for (const timer of replyTimers) clearTimeout(timer); replyTimers.clear() },
  }
}
