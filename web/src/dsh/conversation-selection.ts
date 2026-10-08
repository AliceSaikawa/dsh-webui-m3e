import type { ISessions, SessionReference, SessionTarget } from './services.ts'
import { observable } from './mock/observable.ts'
import { resolveConversationTarget } from './session-navigation.ts'
import { RemoteCallError } from './remote-result.ts'
import { conversationSessionId } from '../app/conversation-route.ts'
export { conversationSessionId } from '../app/conversation-route.ts'

export const MAIN_VIEW_SOURCE = 'm3e.mainView'
export interface ConversationSelectionState { sessionId?: string; pending: boolean; error?: unknown; visibleSessionId?: string }
const pageWindow = () => (globalThis as { window?: { location?: { hash: string }; addEventListener(name: string, listener: () => void): void; removeEventListener(name: string, listener: () => void): void } }).window
const owners = new WeakMap<ISessions, ConversationSelection>()

/** One owner per controller, outside React lifetimes (including StrictMode). */
export function conversationSelection(sessions: ISessions): ConversationSelection {
  let owner = owners.get(sessions)
  if (!owner) { owner = new ConversationSelection(sessions); owners.set(sessions, owner) }
  return owner
}

export class ConversationSelection {
  readonly state = observable<ConversationSelectionState>({ pending: false })
  private reference?: SessionReference
  private unsubscribeReference?: () => void
  private revision = 0
  private desired?: string
  private routeSessionId?: string
  private flight: Promise<boolean> = Promise.resolve(false)
  private cancelWait?: () => void
  private readonly preparations = new Set<AbortController>()
  private pageHidden = false
  private readonly onPageHide = () => { this.pageHidden = true; this.clear() }
  private readonly onPageShow = () => {
    if (!this.pageHidden) return
    this.pageHidden = false
    const id = conversationSessionId(pageWindow()?.location?.hash.replace(/^#/, '') ?? '/')
    void this.select(id).catch(() => { /* The owner exposes the open error to the conversation. */ })
  }
  private readonly sessions: ISessions
  constructor(sessions: ISessions) {
    this.sessions = sessions
    pageWindow()?.addEventListener('pagehide', this.onPageHide)
    pageWindow()?.addEventListener('pageshow', this.onPageShow)
  }
  async select(target: SessionTarget | undefined): Promise<boolean> {
    if (target === undefined) { this.clear(); return Promise.resolve(true) }
    const key = typeof target === 'string' ? target : JSON.stringify(target)
    const sessionId = typeof target === 'string' ? target : target.childSessionId
    this.routeChanged(sessionId)
    // Address resolution must not turn a route remount into a new generation.
    if (key === this.desired) return this.flight
    this.desired = key
    const revision = ++this.revision
    for (const controller of this.preparations) controller.abort()
    this.cancelWait?.()
    this.state.set({ sessionId, pending: true })
    this.flight = this.open(target, revision)
    return this.flight
  }
  /** Convey the current URL even while the app waits for its workspace baseline. */
  routeChanged(sessionId: string | undefined): void {
    this.routeSessionId = sessionId
    const current = this.state.getSnapshot()
    const visibleSessionId = !current.pending && !current.error && current.sessionId === sessionId
      && this.reference?.binding.session.getSnapshot().openState === 'open' ? sessionId : undefined
    if (visibleSessionId !== current.visibleSessionId) this.state.set({ ...current, visibleSessionId })
  }
  private openedState(sessionId: string): ConversationSelectionState {
    return { sessionId, pending: false, visibleSessionId: this.routeSessionId === sessionId
      && this.reference?.binding.session.getSnapshot().openState === 'open' ? sessionId : undefined }
  }
  /** Commit a ready delivery/preparation while its reference still owns the generation. */
  adopt(reference: SessionReference): void {
    const binding = reference.binding
    this.checkOpen(binding.session.getSnapshot())
    const target = binding.session.getSnapshot().subagent?.address ?? reference.sessionId
    const next = this.sessions.retain(target, { source: MAIN_VIEW_SOURCE })
    ++this.revision
    for (const controller of this.preparations) controller.abort()
    this.cancelWait?.()
    this.desired = typeof target === 'string' ? target : JSON.stringify(target)
    this.replaceReference(next)
    this.state.set(this.openedState(next.sessionId))
    this.flight = Promise.resolve(true)
  }
  /** Preparation never changes the visible selection. Only a live caller may commit it. */
  async prepare(target: SessionTarget, isActive: () => boolean, commit: () => void, signal?: AbortSignal): Promise<boolean> {
    const revision = this.revision
    const controller = new AbortController()
    this.preparations.add(controller)
    const lifetime = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    const active = () => !lifetime.aborted && revision === this.revision && isActive()
    let reference: SessionReference | undefined
    try {
      const resolved = typeof target === 'string' ? await resolveConversationTarget(this.sessions, target, active) : target
      if (!active() || resolved === undefined) return false
      if (typeof resolved !== 'string' && resolved.mode === 'unknown') throw new Error('子の会話の情報を読み込めませんでした。')
      reference = this.sessions.retain(resolved, { source: 'm3e.navigation', signal: lifetime })
      const binding = await reference.ready
      if (!active()) return false
      this.checkOpen(binding.session.getSnapshot())
      this.adopt(reference)
      commit()
      return true
    } catch (error) {
      if (!active()) return false
      throw error
    } finally { reference?.release(); this.preparations.delete(controller) }
  }
  private checkOpen(snapshot: { openState: string; openError: import('./services.ts').RemoteFailure | null }): void {
    if (snapshot.openState === 'error') throw new RemoteCallError(snapshot.openError ?? { code: 'session/open-failed', message: '会話を開けませんでした。', details: {} })
  }
  private async open(target: SessionTarget, revision: number): Promise<boolean> {
    const active = () => revision === this.revision
    try {
      if (typeof target === 'string' && this.reference?.sessionId === target && this.reference.binding.session.getSnapshot().openState === 'open') {
        this.state.set(this.openedState(target))
        return true
      }
      if (typeof target === 'string' && this.sessions.list.getSnapshot().phase !== 'ready') {
        await new Promise<void>(resolve => {
          const finish = () => { unsubscribe(); if (this.cancelWait === finish) this.cancelWait = undefined; resolve() }
          const unsubscribe = this.sessions.list.subscribe(() => { if (this.sessions.list.getSnapshot().phase === 'ready') finish() })
          this.cancelWait = finish
        })
      }
      if (!active()) return false
      const resolved = typeof target === 'string' ? await resolveConversationTarget(this.sessions, target, active) : target
      if (!active() || resolved === undefined) return false
      if (typeof resolved !== 'string' && resolved.mode === 'unknown') throw new Error('子の会話の情報を読み込めませんでした。')
      const acquired = this.sessions.retain(resolved, { source: MAIN_VIEW_SOURCE })
      // Transfer ownership synchronously. This async operation only borrows it
      // from here on; stale completions must never release the owner's reference.
      this.replaceReference(acquired)
      const binding = await acquired.ready
      if (!active()) return false
      const snapshot = binding.session.getSnapshot()
      this.checkOpen(snapshot)
      this.state.set(this.openedState(acquired.sessionId))
      return true
    } catch (error) {
      if (!active()) return false
      this.replaceReference(undefined)
      this.desired = undefined
      this.state.set({ ...this.state.getSnapshot(), pending: false, error })
      throw error
    }
  }
  /** The sole release point for the main-view reference, including pending opens. */
  private replaceReference(next: SessionReference | undefined): void {
    const previous = this.reference
    this.unsubscribeReference?.()
    this.unsubscribeReference = undefined
    this.reference = next
    previous?.release()
    if (next && this.reference === next) this.unsubscribeReference = next.binding.session.subscribe(() => {
      if (this.reference === next) this.routeChanged(this.routeSessionId)
    })
  }
  clear(): void {
    ++this.revision
    for (const controller of this.preparations) controller.abort()
    this.desired = undefined
    this.routeSessionId = undefined
    this.cancelWait?.()
    this.state.set({ pending: false })
    this.replaceReference(undefined)
  }
  dispose(): void {
    this.clear()
    pageWindow()?.removeEventListener('pagehide', this.onPageHide)
    pageWindow()?.removeEventListener('pageshow', this.onPageShow)
    owners.delete(this.sessions)
  }
}

export function createConversationVisitTracker(onReentry: (sessionId: string) => void): (sessionId: string | undefined) => void {
  const visited = new Set<string>()
  let lastSessionId: string | undefined
  return sessionId => {
    if (sessionId === undefined || sessionId === lastSessionId) return
    const returning = visited.has(sessionId)
    visited.add(sessionId)
    lastSessionId = sessionId
    if (returning) onReentry(sessionId)
  }
}
