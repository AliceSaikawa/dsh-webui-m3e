import {
  goalPhaseLabel, goalPrimaryAction,
  type GoalActivation, type GoalDisplayState,
} from './operations.ts'
import type { SessionToolsText } from './messages.ts'

export interface GoalPresenceInput {
  readonly current: GoalDisplayState | null | undefined
  readonly activation: GoalActivation | undefined
  readonly activationReady: boolean
  readonly activationError: boolean
  /** Child (subagent) sessions only display the goal. */
  readonly readOnly: boolean
  readonly busy: boolean
  /** '' when none. */
  readonly error: string
  readonly needsRefresh: boolean
  /** Remote exposes goals.edit. */
  readonly editSupported: boolean
  readonly goalsSupported: boolean
  readonly connected: boolean
}

export type GoalStripActionKind = 'pause' | 'resume' | 'edit' | 'reload' | 'retry-activation'
export interface GoalStripAction { readonly kind: GoalStripActionKind; readonly enabled: boolean }
export interface GoalStripMessage { readonly tone: 'error' | 'info'; readonly text: string }
export interface GoalStripModel {
  readonly objective: string
  readonly statusLine: string
  readonly actions: readonly GoalStripAction[]
  readonly message?: GoalStripMessage
}
export type GoalStripVisibility =
  | { readonly kind: 'hidden' }
  | { readonly kind: 'visible'; readonly model: GoalStripModel }

export interface GoalPresenceModel {
  readonly primary: 'pause' | 'resume' | undefined
  readonly exhausted: boolean
  readonly canMutate: boolean
  readonly canEdit: boolean
  readonly statusLine: string
  readonly strip: GoalStripVisibility
}

/**
 * Owns the only computation of the goal actions and strip visibility, so
 * GoalScreen and GoalStrip cannot disagree.
 */
export function goalPresenceModel(input: GoalPresenceInput, text: SessionToolsText): GoalPresenceModel {
  const goal = input.current?.goal
  const rounds = input.current?.roundsStarted ?? 0
  const primary = goal ? goalPrimaryAction(goal, input.activation) : undefined
  const exhausted = goal !== undefined && primary === 'resume' && rounds >= goal.maxGoalRounds
  const canMutate = !input.readOnly && input.goalsSupported && input.connected && input.activationReady
    && !input.busy && !input.needsRefresh && input.activation !== undefined
  const canEdit = input.editSupported && input.goalsSupported && !input.readOnly
  const statusLine = goal
    ? text.goalStatusLine(goalPhaseLabel(goal.phase, input.activation, text), rounds, goal.maxGoalRounds)
    : ''

  if (!goal || goal.phase === 'complete') {
    return { primary, exhausted, canMutate, canEdit, statusLine, strip: { kind: 'hidden' } }
  }

  const message: GoalStripMessage | undefined = input.error !== ''
    ? { tone: 'error', text: input.error }
    : input.activationError
      ? { tone: 'error', text: text.activationFailed }
      : goal.phase === 'blocked' && goal.blockedReason
        ? { tone: 'info', text: goal.blockedReason.message }
        : exhausted
          ? { tone: 'info', text: text.roundsExhausted }
          : undefined

  const actions: readonly GoalStripAction[] = input.readOnly
    ? []
    : input.error !== ''
      ? [{ kind: 'reload', enabled: !input.busy && input.connected && input.goalsSupported }]
      : input.activationError
        ? [{ kind: 'retry-activation', enabled: !input.busy && input.connected && input.goalsSupported }]
        : [
            ...(primary ? [{ kind: primary, enabled: canMutate && !exhausted }] : []),
            ...(canEdit ? [{ kind: 'edit' as const, enabled: canMutate }] : []),
          ]

  const model: GoalStripModel = {
    objective: goal.objective,
    statusLine,
    actions,
    ...(message ? { message } : {}),
  }
  return { primary, exhausted, canMutate, canEdit, statusLine, strip: { kind: 'visible', model } }
}

/**
 * Smallest visual-viewport height (px) where the strip is rendered.
 * Header/tabs 129 + footer and frame padding 38 + controls 48 + textarea
 * padding 10 + empty textarea 34 = 259; the strip with its message row
 * reserves 92 and the conversation keeps 48 → 399.
 */
export const GOAL_STRIP_MIN_VIEWPORT_HEIGHT = 400

export function goalStripFits(viewportHeight: number): boolean {
  return viewportHeight >= GOAL_STRIP_MIN_VIEWPORT_HEIGHT
}
