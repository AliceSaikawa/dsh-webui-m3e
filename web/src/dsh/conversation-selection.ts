import type { ISessions, SessionReference, SessionTarget } from './services.ts'
import { observable } from './mock/observable.ts'
import { resolveConversationTarget } from './session-navigation.ts'
import { RemoteCallError } from './remote-result.ts'

export const MAIN_VIEW_SOURCE = 'm3e.mainView'
export interface ConversationSelectionState { sessionId?: string; pending: boolean; error?: unknown }
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
  private revision = 0
  private desired?: string
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
  select(target: SessionTarget | undefined): Promise<boolean> {
    if (target === undefined) { this.clear(); return Promise.resolve(true) }
    const key = typeof target === 'string' ? target : JSON.stringify(target)
    const sessionId = typeof target === 'string' ? target : target.childSessionId
    // Address resolution must not turn a route remount into a new generation.
    if (key === this.desired) return this.flight
    this.desired = key
    const revision = ++this.revision
    for (const controller of this.preparations) controller.abort()
    this.cancelWait?.()
    if (this.reference?.sessionId === sessionId && typeof target === 'string' && this.reference.binding.session.getSnapshot().openState === 'open') {
      this.state.set({ sessionId, pending: false })
      return this.flight = Promise.resolve(true)
    }
    this.state.set({ sessionId, pending: true })
    this.flight = this.open(target, revision)
    return this.flight
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
    const previous = this.reference
    this.reference = next
    previous?.release()
    this.state.set({ sessionId: next.sessionId, pending: false })
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
    let acquired: SessionReference | undefined
    const active = () => revision === this.revision
    try {
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
      acquired = this.sessions.retain(resolved, { source: MAIN_VIEW_SOURCE })
      // Acquire first: never drop an overlapping generation to zero.
      const previous = this.reference
      this.reference = acquired
      previous?.release()
      const binding = await acquired.ready
      if (!active()) { acquired.release(); return false }
      const snapshot = binding.session.getSnapshot()
      this.checkOpen(snapshot)
      this.state.set({ sessionId: acquired.sessionId, pending: false })
      return true
    } catch (error) {
      acquired?.release()
      if (!active()) return false
      this.reference?.release()
      this.reference = undefined
      this.desired = undefined
      this.state.set({ ...this.state.getSnapshot(), pending: false, error })
      throw error
    }
  }
  clear(): void {
    ++this.revision
    for (const controller of this.preparations) controller.abort()
    this.desired = undefined
    this.cancelWait?.()
    this.reference?.release()
    this.reference = undefined
    this.state.set({ pending: false })
  }
  dispose(): void {
    this.clear()
    pageWindow()?.removeEventListener('pagehide', this.onPageHide)
    pageWindow()?.removeEventListener('pageshow', this.onPageShow)
    owners.delete(this.sessions)
  }
}

export function conversationSessionId(pathname: string): string | undefined {
  const encoded = /^\/s\/([^/]+)(?:\/|$)/.exec(pathname)?.[1]
  if (!encoded) return undefined
  try { return decodeURIComponent(encoded) || undefined } catch { return undefined }
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

export function canSelectConversation(sessions: Pick<ISessions, 'list' | 'subagentAddress'>, sessionId: string | undefined): boolean {
  return sessionId !== undefined && (!!sessions.list.getSnapshot().byId[sessionId] || sessions.subagentAddress(sessionId) !== undefined)
}
