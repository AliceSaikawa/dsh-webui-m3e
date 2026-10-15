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

interface Baseline { revision: number; draft: Draft }
function settle(draft: Draft): Draft {
  const { workspaceAttachment: _attachment, workspaceAttachmentError: _attachmentError, ...rest } = draft
  return rest
}

/**
 * Applies the registration result and moves the body as separate steps. The
 * created conversation's draft is replaced only when nothing wrote it after
 * the retry began; otherwise its newer input stays and only the recovery
 * state is settled.
 */
function handOff(draftKey: string, attachment: WorkspaceAttachment, baseline: Baseline, { settled, clearOrigin }: { settled: boolean; clearOrigin: boolean }): void {
  const destination = `session:${attachment.sessionId}`
  if (draftKey === destination) {
    if (!settled) return
    const current = readDraft(destination)
    writeDraft(destination, settle(current))
    clearWorkspaceOrigin(attachment, current)
    return
  }
  const origin = readDraft(draftKey)
  if (draftRevision(destination) === baseline.revision) {
    writeDraft(destination, settled ? settle(origin) : origin)
    if (clearOrigin) clearDraft(draftKey)
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
  const baseline: Baseline = { revision: draftRevision(destination), draft: readDraft(destination) }
  try {
    // The Host adopts when sessionId is supplied. Never retry this operation with a fresh identity.
    const sessionId = await sessions.create({ workspaceId: attachment.workspaceId, sessionId: attachment.sessionId })
    if (sessionId !== attachment.sessionId) throw new Error('登録した会話を確認できませんでした。')
    const sessionReady = await sessionIsAddressable(sessions, sessionId)
    if (!sessionReady) {
      handOff(draftKey, attachment, baseline, { settled: false, clearOrigin: false })
      return { sessionId, sessionReady, error: new Error('会話の一覧を更新できませんでした。もう一度お試しください。') }
    }
    handOff(draftKey, attachment, baseline, { settled: true, clearOrigin: true })
    return { sessionId, sessionReady }
  } catch (error) {
    const sessionReady = await sessionIsAddressable(sessions, attachment.sessionId)
    handOff(draftKey, attachment, baseline, { settled: false, clearOrigin: sessionReady })
    return { sessionId: attachment.sessionId, sessionReady, error }
  }
}
