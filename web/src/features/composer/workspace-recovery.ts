import type { ISessions } from '../../dsh/services.ts'
import { clearDraft, draftRevision, readDraft, writeDraft, type Draft } from './drafts.ts'

export interface WorkspaceAttachment { workspaceId: string; sessionId: string }
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

function sameContent(a: Draft, b: Draft): boolean {
  return a.text === b.text && a.images.length === b.images.length
    && a.images.every((image, index) => image === b.images[index])
    && a.model?.provider === b.model?.provider && a.model?.model === b.model?.model
    && a.model?.reasoningEffort === b.model?.reasoningEffort
    && a.permission === b.permission && a.plan === b.plan
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
  writeDraft(draftKey, { ...current, workspaceAttachment: adopted })
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

interface Baseline { revision: number; draft: Draft; sameAtStart: boolean }
function settle(draft: Draft): Draft {
  const { workspaceAttachment: _attachment, workspaceAttachmentError: _attachmentError, ...rest } = draft
  return rest
}

/**
 * Applies the registration result and moves the body as separate steps. The
 * created conversation's draft is replaced only when it held the same input as
 * the origin when the retry began and nothing wrote it after that; a draft the
 * user already edited on either screen is never replaced. Otherwise only the
 * recovery state is settled, and a distinct origin input stays as an ordinary
 * draft for the new screen.
 */
function handOff(draftKey: string, attachment: WorkspaceAttachment, baseline: Baseline, { settled, clearOrigin }: { settled: boolean; clearOrigin: boolean }): void {
  const destination = `session:${attachment.sessionId}`
  // An unsettled destination keeps the recovery state for the identity this
  // handoff actually registered, which may differ from the recorded one.
  const forDestination = (draft: Draft): Draft => settled ? settle(draft) : { ...settle(draft), workspaceAttachment: attachment }
  if (draftKey === destination) {
    if (!settled) return
    const current = readDraft(destination)
    writeDraft(destination, settle(current))
    clearWorkspaceOrigin(attachment, current)
    return
  }
  const origin = readDraft(draftKey)
  if (draftRevision(destination) === baseline.revision) {
    if (baseline.sameAtStart || sameContent(origin, baseline.draft)) {
      writeDraft(destination, forDestination(origin))
      if (clearOrigin) clearDraft(draftKey)
      return
    }
    // The destination already held a different draft before the retry began,
    // so registration only settles it and both inputs stay where they are.
    if (settled) {
      writeDraft(destination, settle(readDraft(destination)))
      writeDraft(draftKey, settle(origin))
    }
    return
  }
  const current = readDraft(destination)
  if (settled && (current.workspaceAttachment || current.workspaceAttachmentError !== undefined)) writeDraft(destination, settle(current))
  // The origin's input was already the destination's when the retry began, so the newer edit supersedes it.
  if (sameContent(origin, baseline.draft)) { if (clearOrigin) clearDraft(draftKey) }
  // A different origin input is not discarded. After registration it is an ordinary draft for this Workspace.
  else if (settled) writeDraft(draftKey, settle(origin))
}

async function runRecovery({ draftKey, sessions }: { draftKey: string; sessions: RecoverySessions }): Promise<WorkspaceRecoveryResult> {
  const initial = readDraft(draftKey)
  const attachment = initial.workspaceAttachment
  if (!attachment || !usableId(attachment.sessionId) || !usableId(attachment.workspaceId)) {
    return { error: new Error('ワークスペースへの登録をやり直す会話がありません。') }
  }
  if ((initial.preparingImages ?? 0) > 0) {
    return { sessionId: attachment.sessionId, sessionReady: false, error: new Error('画像の準備が終わってから登録をやり直してください。') }
  }
  const destination = `session:${attachment.sessionId}`
  const destinationDraft = readDraft(destination)
  const baseline: Baseline = { revision: draftRevision(destination), draft: destinationDraft,
    sameAtStart: sameContent(initial, destinationDraft) }
  // A fresh identity has no earlier input of its own, so the retry may move the origin there.
  const baselineFor = (sessionId: string): Baseline => sessionId === attachment.sessionId
    ? baseline
    : { revision: draftRevision(`session:${sessionId}`), draft: readDraft(`session:${sessionId}`), sameAtStart: true }
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
      return { sessionId: adopted.sessionId, sessionReady, error: new Error('会話の一覧を更新できませんでした。もう一度お試しください。') }
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
