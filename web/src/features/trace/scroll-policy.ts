export interface TraceScrollState {
  active: boolean
  initialized: boolean
  hasRows: boolean
  visible: boolean
  following: boolean
  searching: boolean
  hasAnchor: boolean
  loadingOlder: boolean
}
export type TraceScrollTrigger = 'activation' | 'content' | 'resize'
export type TraceScrollAction = 'none' | 'bottom' | 'anchor'

/** Activation belongs to RetainedScrollPanel once the first view has been shown. */
export function traceScrollAction(state: TraceScrollState, trigger: TraceScrollTrigger): TraceScrollAction {
  if (!state.active || !state.visible || !state.hasRows) return 'none'
  if (state.initialized && trigger === 'activation') return 'none'
  if (state.hasAnchor) return state.loadingOlder ? 'none' : 'anchor'
  if (!state.initialized) return 'bottom'
  return state.following && !state.searching ? 'bottom' : 'none'
}

/** Do not read layout while inactive; callers invoke this only after that guard. */
export function isTraceAtBottom(scrollTop: number, scrollHeight: number, clientHeight: number): boolean {
  return clientHeight > 0 && scrollHeight - scrollTop - clientHeight < 48
}
