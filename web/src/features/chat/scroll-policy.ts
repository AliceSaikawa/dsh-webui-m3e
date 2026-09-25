export interface ChatScrollState {
  readonly active: boolean
  readonly initialized: boolean
  readonly restoring: boolean
  readonly following: boolean
}
export const initialChatScrollState: ChatScrollState = { active: false, initialized: false, restoring: false, following: true }

/** Keep the reader's following mode while the parent restores its retained position. */
export function enterChatVisibility(state: ChatScrollState, active: boolean, ready: boolean): {
  state: ChatScrollState; action: 'suspend' | 'wait' | 'initialize' | 'resume' | 'none'
} {
  if (!active) return { state: { ...state, active: false, restoring: false }, action: 'suspend' }
  if (!ready) return { state, action: 'wait' }
  if (!state.initialized) return { state: { active: true, initialized: true, restoring: false, following: true }, action: 'initialize' }
  if (!state.active || state.restoring) return { state: { ...state, active: true, restoring: true }, action: 'resume' }
  return { state, action: 'none' }
}

/** Call only after the parent's restore: resume following or keep the reading position. */
export function finishChatRestore(state: ChatScrollState): { state: ChatScrollState; action: 'bottom' | 'preserve' | 'none' } {
  if (!state.active || !state.restoring) return { state, action: 'none' }
  return { state: { ...state, restoring: false }, action: state.following ? 'bottom' : 'preserve' }
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
