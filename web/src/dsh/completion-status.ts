import type { DshContext, SessionListState, SessionSummary } from './services.ts'
import { observable } from './mock/observable.ts'
import { conversationSelection } from './conversation-selection.ts'

export type M3eSessionList = Omit<SessionListState, 'byId'> & { byId: Record<string, SessionSummary & { completionUnread?: boolean }> }
const stores = new WeakMap<DshContext, ReturnType<typeof createCompletionStatus>>()
export function completionStatus(ctx: DshContext) {
  let store = stores.get(ctx)
  if (!store) { store = createCompletionStatus(ctx); stores.set(ctx, store) }
  return store
}

/** Port of ui-session observeRunning/reconcileStatus, using M3E's ready visible selection.
 * Baseline idle rows are read; only observed completions become unread. No persistence.
 */
function createCompletionStatus(ctx: DshContext) {
  const running = new Map<string, boolean>()
  const unread = new Set<string>()
  const state = observable<M3eSessionList>({ ...ctx.sessions.list.getSnapshot(), byId: {} })
  const selection = conversationSelection(ctx.sessions)
  const isMain = (id: string) => selection.state.getSnapshot().visibleSessionId === id
  const publish = () => {
    const list = ctx.sessions.list.getSnapshot()
    state.set({ ...list, byId: Object.fromEntries(Object.entries(list.byId).map(([id, row]) => [id, { ...row, completionUnread: unread.has(id) }])) })
  }
  const observe = (id: string, value: boolean) => {
    const previous = running.get(id)
    running.set(id, value)
    if (value) unread.delete(id)
    else if ((previous === true || (previous === undefined && ctx.sessions.list.getSnapshot().phase === 'pending')) && !isMain(id)) unread.add(id)
  }
  const reconcile = () => {
    const list = ctx.sessions.list.getSnapshot()
    for (const id of list.ids) {
      const row = list.byId[id]!
      const previous = running.get(id)
      if (previous === undefined) running.set(id, row.running)
      else if (previous !== row.running) observe(id, row.running)
    }
    for (const id of Object.keys(list.byId)) if (isMain(id)) unread.delete(id)
    if (list.phase === 'ready') for (const id of running.keys()) if (!list.byId[id]) { running.delete(id); unread.delete(id) }
    publish()
  }
  const unsubscribe = ctx.sessions.list.subscribe(reconcile)
  const unsubscribeSelection = selection.state.subscribe(reconcile)
  const on = ctx.remote.$on as ((event: string, handler: (id: string, running: boolean) => void) => (() => void)) | undefined
  const off = on?.call(ctx.remote, 'api-session/status', (id, value) => { observe(id, value); publish() })
  reconcile()
  return { ...state, dispose() { unsubscribe(); unsubscribeSelection(); off?.(); stores.delete(ctx) } }
}
