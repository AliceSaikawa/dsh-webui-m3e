import {
  goalPrimaryAction,
  type GoalActivation, type GoalDisplayState,
} from './operations.ts'

export interface GoalStripModel {
  readonly objective: string
  readonly statusLine: string
  readonly primary: 'pause' | 'resume' | undefined
  /** false when child session, disconnected, unsupported remote, busy, or activation not ready */
  readonly canMutate: boolean
  readonly canEdit: boolean
  readonly exhausted: boolean
  readonly blockedMessage?: string
  readonly inlineError?: string
}

export type GoalStripVisibility =
  | { readonly kind: 'hidden' }
  | { readonly kind: 'visible'; readonly model: GoalStripModel }

export interface GoalStripVisibleInput {
  readonly current: GoalDisplayState | null | undefined
  readonly activation: GoalActivation | undefined
  readonly activationReady: boolean
  readonly readOnly: boolean
  readonly busy: boolean
  readonly error: string
  readonly needsRefresh: boolean
  readonly canEdit: boolean
  readonly goalsSupported: boolean
  readonly connected: boolean
  readonly statusLine: string
}

/**
 * Single predicate for strip visibility. GoalStrip must not branch on phase itself.
 * Hide when: current undefined (loading), null (absent/cleared), or phase === 'complete'.
 */
export function goalStripVisible(state: GoalStripVisibleInput): GoalStripVisibility {
  if (state.current === undefined || state.current === null) return { kind: 'hidden' }
  const goal = state.current.goal
  if (goal.phase === 'complete') return { kind: 'hidden' }
  const primary = goalPrimaryAction(goal, state.activation)
  const exhausted = primary === 'resume' && state.current.roundsStarted >= goal.maxGoalRounds
  const canMutate = !state.readOnly && state.goalsSupported && state.connected && state.activationReady
    && !state.busy && !state.needsRefresh && state.activation !== undefined
  return {
    kind: 'visible',
    model: {
      objective: goal.objective,
      statusLine: state.statusLine,
      primary,
      canMutate,
      canEdit: state.canEdit && !state.readOnly && state.goalsSupported,
      exhausted,
      ...(goal.phase === 'blocked' && goal.blockedReason ? { blockedMessage: goal.blockedReason.message } : {}),
      ...(state.error ? { inlineError: state.error } : {}),
    },
  }
}
