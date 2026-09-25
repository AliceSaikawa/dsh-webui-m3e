import { isNearBottom, type ScrollMetrics } from './model.ts'

export interface ChatScrollState {
  readonly active: boolean
  readonly initialized: boolean
  readonly restoring: boolean
  readonly following: boolean
}
export const initialChatScrollState: ChatScrollState = { active: false, initialized: false, restoring: false, following: true }

/** Resume is read-only until the parent's retained DOM positions have been restored. */
export function enterChatVisibility(state: ChatScrollState, active: boolean, ready: boolean): {
  state: ChatScrollState; action: 'suspend' | 'wait' | 'initialize' | 'resume' | 'none'
} {
  if (!active) return { state: { ...state, active: false, restoring: false }, action: 'suspend' }
  if (!ready) return { state, action: 'wait' }
  if (!state.initialized) return { state: { active: true, initialized: true, restoring: false, following: true }, action: 'initialize' }
  if (!state.active || state.restoring) return { state: { ...state, active: true, restoring: true, following: false }, action: 'resume' }
  return { state, action: 'none' }
}

export function finishChatRestore(state: ChatScrollState, metrics: ScrollMetrics): ChatScrollState {
  if (!state.active || !state.restoring) return state
  return { ...state, restoring: false, following: isNearBottom(metrics, 4) }
}

export function canObserveChatScroll(state: ChatScrollState): boolean {
  return state.active && state.initialized && !state.restoring
}

export function decideChatScroll(state: ChatScrollState, pendingPrepend: boolean, loadingOlder: boolean): 'none' | 'anchor' | 'bottom' {
  if (!canObserveChatScroll(state)) return 'none'
  if (pendingPrepend) return loadingOlder ? 'none' : 'anchor'
  return state.following ? 'bottom' : 'none'
}

/** An anchor captured before hiding must not overwrite the panel's restored position. */
export function shouldDiscardChatAnchor(active: boolean, restoring: boolean): boolean {
  return !active || restoring
}
