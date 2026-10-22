import type { ISessions } from '../../dsh/services.ts'
import { clearDraft, readDraft, writeDraft, type Draft, type WorkspaceAttachment, type WorkspaceAttachmentBaseline } from './drafts.ts'
import { composerText } from './messages.ts'
import { LocalizedError } from './localized-error.ts'

export type { WorkspaceAttachment, WorkspaceAttachmentBaseline } from './drafts.ts'
export interface WorkspaceRecoveryResult { sessionId?: string; sessionReady?: boolean; error?: unknown }
type RecoverySessions = Pick<ISessions, 'create' | 'list' | 'refresh'>
const recoveries = new Map<string, Promise<WorkspaceRecoveryResult>>()
/** One retry per created identity: the new screen and the created conversation's composer join the same Promise. */
export function pendingWorkspaceAttachment(draftKey: string): Promise<WorkspaceRecoveryResult> | undefined {
  const active = recoveries.get(draftKey)
  if (active || !draftKey.startsWith('new:')) return active
  const retained = readDraft(draftKey).workspaceAttachment
  const valid = retained && workspaceAttachmentFrom({ code: 'session/workspace-attach-failed', details: retained }, draftKey.slice(4))
  return valid ? recoveries.get(`session:${valid.sessionId}`) : undefined
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function usableId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !/[\s\u0000-\u001f\u007f-\u009f]/u.test(value)
}

/** SessionCreateError wraps the Host failure in rpcError; other failures prove no published identity. */
export function workspaceAttachmentFrom(error: unknown, workspaceId: string): WorkspaceAttachment | undefined {
  const outer = object(error)
  const failure = object(outer?.rpcError) ?? outer
  if (failure?.code !== 'session/workspace-attach-failed') return undefined
  const details = object(failure.details)
  if (!usableId(details?.sessionId) || details?.workspaceId !== workspaceId) return undefined
  return { workspaceId, sessionId: details.sessionId }
}

/** Partial create errors publish through the controller notifier, without its success-only synchronous projection. */
export async function sessionIsAddressable(sessions: Pick<ISessions, 'list' | 'refresh'>, sessionId: string): Promise<boolean> {
  if (sessions.list.getSnapshot().byId[sessionId]) return true
  try { await sessions.refresh() } catch { /* Keep the recovered identity even while list refresh is unavailable. */ }
  return sessions.list.getSnapshot().byId[sessionId] !== undefined
}

/** The input the recovery must compare: body, images and choices, not recovery metadata. */
export function attachmentBaseline(draft: Draft): WorkspaceAttachmentBaseline {
  return { text: draft.text, input: { images: draft.images, model: draft.model, permission: draft.permission, plan: draft.plan } }
}
function sameInput(a: Pick<Draft, 'images' | 'model' | 'permission' | 'plan'>, b: Pick<Draft, 'images' | 'model' | 'permission' | 'plan'>): boolean {
  return a.images.length === b.images.length && a.images.every((image, index) => image === b.images[index])
    && a.model?.provider === b.model?.provider && a.model?.model === b.model?.model
    && a.model?.reasoningEffort === b.model?.reasoningEffort
    && a.permission === b.permission && a.plan === b.plan
}
function sameContent(a: Draft, b: Draft): boolean {
  return a.text === b.text && sameInput(a, b)
}
/**
 * Whether the draft still holds the input recorded at the failure. A reload
 * restores the body alone, so an absent `input` stands for the empty images and
 * choices that reload leaves behind; comparing only the body would treat input
 * added after the reload as the failure state.
 */
function matchesBaseline(draft: Draft, baseline: WorkspaceAttachmentBaseline | undefined): boolean {
  if (!baseline || draft.text !== baseline.text) return false
  return sameInput(draft, baseline.input ?? { images: [] })
}

/**
 * Drop the retry state of the recorded conversation once the Host reported
 * another identity. DSH 0.2.1 reuses a named Session only while it is a blank
 * member of the requested Workspace and otherwise creates a new one, so the
 * recorded identity can no longer be registered. Its draft is only the copy of
 * this recovery when it still holds the same input; a divergent input stays as
 * an ordinary draft for the unregistered conversation.
 */
function settleSuperseded(recorded: WorkspaceAttachment, adopted: WorkspaceAttachment, source: Draft): void {
  if (adopted.sessionId === recorded.sessionId) return
  for (const key of [`session:${recorded.sessionId}`, `new:${recorded.workspaceId}`]) {
    const draft = readDraft(key)
    if (draft.workspaceAttachment?.sessionId !== recorded.sessionId) continue
    if (sameContent(draft, source)) clearDraft(key)
    else writeDraft(key, settle(draft))
  }
}

/**
 * Before the adopted identity reaches the list the composer cannot navigate to
 * it, so the screen the user started from must keep its retry action. Naming the
 * newest identity also stops the next attempt from repeating a superseded one.
 */
function keepRetryOnCurrent(draftKey: string, adopted: WorkspaceAttachment): void {
  const current = readDraft(draftKey)
  if (!current.workspaceAttachment || current.workspaceAttachment.sessionId === adopted.sessionId) return
  writeDraft(draftKey, { ...current, workspaceAttachment: { ...adopted, baseline: attachmentBaseline(current) } })
}

export function clearWorkspaceOrigin(attachment: WorkspaceAttachment, delivered: Draft): void {
  const originKey = `new:${attachment.workspaceId}`
  const origin = readDraft(originKey)
  // This is local draft ownership after a confirmed send/recovery, not a
  // guess about Host acceptance or a content-based submission deduplication.
  if (origin.workspaceAttachment?.sessionId === attachment.sessionId && sameContent(origin, delivered)) clearDraft(originKey)
}

/** Separate from sending: adopt the same published identity and retry only its Workspace attachment. */
export function retryWorkspaceAttachment(options: { draftKey: string; sessions: RecoverySessions }): Promise<WorkspaceRecoveryResult> {
  const keys = new Set([options.draftKey])
  const retained = readDraft(options.draftKey).workspaceAttachment
  if (retained && usableId(retained.sessionId)) keys.add(`session:${retained.sessionId}`)
  for (const key of keys) {
    const active = pendingWorkspaceAttachment(key)
    if (active) return active
  }
  const recovery = runRecovery(options).finally(() => {
    for (const key of keys) if (recoveries.get(key) === recovery) recoveries.delete(key)
  })
  for (const key of keys) recoveries.set(key, recovery)
  return recovery
}

interface Baseline {
  /** The Host minted a new identity, so no draft holds this recovery's state for it yet. */
  fresh: boolean
  /** What the created conversation held when registration failed. Missing for states saved before it was recorded. */
  recorded: WorkspaceAttachmentBaseline | undefined
}
/** A minted identity did not exist when registration failed, so it held no input then. */
const MINTED_BASELINE: WorkspaceAttachmentBaseline = { text: '', input: { images: [] } }
function settle(draft: Draft): Draft {
  const { workspaceAttachment: _attachment, workspaceAttachmentError: _attachmentError, ...rest } = draft
  return rest
}

/**
 * Applies the registration result and moves the body as separate steps. The
 * recorded failure-time input decides which screen holds the newer body:
 * a conversation still holding it receives the new screen's body, a conversation
 * the user edited keeps its own, and two edited screens are both kept. A screen
 * whose body was already superseded does not keep the recovery notice.
 */
function handOff(draftKey: string, attachment: WorkspaceAttachment, baseline: Baseline, { settled, clearOrigin }: { settled: boolean; clearOrigin: boolean }): void {
  const destination = `session:${attachment.sessionId}`
  // The screen the retry started from: the new screen, or the recorded conversation's key.
  const sourceKey = draftKey === destination ? `new:${attachment.workspaceId}` : draftKey
  const source = readDraft(sourceKey)
  // A body on the new screen belongs to this recovery only while it names the same identity.
  const ownsSource = sourceKey === draftKey || source.workspaceAttachment?.sessionId === attachment.sessionId
  const destinationDraft = readDraft(destination)
  // A state saved before the failure body was recorded can only be judged by the source it still copies.
  // A minted conversation can reach the list before the create response, and
  // input written there in the meantime is newer than the retried body.
  const destinationUnchanged = matchesBaseline(destinationDraft, baseline.recorded)
    || (baseline.recorded === undefined && sameContent(destinationDraft, source))
  // The destination keeps the input it receives, so a retry state written there
  // records that input even when the Host minted a new identity.
  const forDestination = (draft: Draft): Draft => settled
    ? settle(draft)
    : { ...settle(draft), workspaceAttachment: { ...attachment, baseline: attachmentBaseline(draft) } }
  if (destinationUnchanged) {
    // The conversation still holds the failure-time body, so the source's input is the newer one.
    if (ownsSource && (settled || baseline.fresh)) {
      writeDraft(destination, forDestination(source))
      if (settled && clearOrigin) clearDraft(sourceKey)
    } else if (settled) {
      writeDraft(destination, settle(destinationDraft))
    }
    return
  }
  // The conversation holds an input written after the failure, so it is kept.
  // A minted conversation also takes over the retry state, recording that input.
  if (settled || baseline.fresh) writeDraft(destination, forDestination(destinationDraft))
  if (!ownsSource) return
  if (matchesBaseline(source, baseline.recorded)) {
    // The source still copied the failure body, which the conversation has moved past.
    if (clearOrigin) clearDraft(sourceKey)
    else if (settled) writeDraft(sourceKey, settle(source))
  } else if (settled || (baseline.fresh && clearOrigin)) {
    // Once the minted conversation can be opened it holds the retry, so the source keeps its body as an ordinary draft.
    writeDraft(sourceKey, settle(source))
  }
}

async function runRecovery({ draftKey, sessions }: { draftKey: string; sessions: RecoverySessions }): Promise<WorkspaceRecoveryResult> {
  const initial = readDraft(draftKey)
  const attachment = initial.workspaceAttachment
  if (!attachment || !usableId(attachment.sessionId) || !usableId(attachment.workspaceId)) {
    return { error: new LocalizedError(composerText().recoveryConversationMissing) }
  }
  if ((initial.preparingImages ?? 0) > 0) {
    return { sessionId: attachment.sessionId, sessionReady: false, error: new LocalizedError(composerText().recoveryImagesPreparing) }
  }
  const baseline: Baseline = { fresh: false, recorded: attachment.baseline }
  // A fresh identity held nothing at the failure, so the retry may move the origin there only while it is still empty.
  const baselineFor = (sessionId: string): Baseline => sessionId === attachment.sessionId
    ? baseline
    : { fresh: true, recorded: MINTED_BASELINE }
  const settleReported = (reported: WorkspaceAttachment, source: Draft): void => settleSuperseded(attachment, reported, source)
  try {
    // DSH 0.2.1 reuses the named Session only while it is an unarchived blank
    // member of the requested Workspace, and otherwise creates and attaches a
    // new one. Follow the identity the Host reports rather than requiring the
    // recorded one.
    const created = await sessions.create({ workspaceId: attachment.workspaceId, sessionId: attachment.sessionId })
    const adopted: WorkspaceAttachment = { workspaceId: attachment.workspaceId, sessionId: usableId(created) ? created : attachment.sessionId }
    const adoptedBaseline = baselineFor(adopted.sessionId)
    const sessionReady = await sessionIsAddressable(sessions, adopted.sessionId)
    const source = readDraft(draftKey)
    if (!sessionReady) {
      handOff(draftKey, adopted, adoptedBaseline, { settled: false, clearOrigin: false })
      keepRetryOnCurrent(draftKey, adopted)
      settleReported(adopted, source)
      return { sessionId: adopted.sessionId, sessionReady, error: new LocalizedError(composerText().recoveryListRefreshFailed) }
    }
    handOff(draftKey, adopted, adoptedBaseline, { settled: true, clearOrigin: true })
    settleReported(adopted, source)
    return { sessionId: adopted.sessionId, sessionReady }
  } catch (error) {
    // A failed attach reports the identity the Host created but could not
    // register; the draft and the next retry follow that newest identity.
    const reported = workspaceAttachmentFrom(error, attachment.workspaceId) ?? attachment
    const sessionReady = await sessionIsAddressable(sessions, reported.sessionId)
    const source = readDraft(draftKey)
    handOff(draftKey, reported, baselineFor(reported.sessionId), { settled: false, clearOrigin: sessionReady })
    if (!sessionReady) keepRetryOnCurrent(draftKey, reported)
    settleReported(reported, source)
    return { sessionId: reported.sessionId, sessionReady, error }
  }
}
