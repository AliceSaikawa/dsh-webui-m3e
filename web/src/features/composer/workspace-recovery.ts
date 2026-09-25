import type { ISessions } from '../../dsh/services.ts'
import { clearDraft, readDraft, writeDraft } from './drafts.ts'

export interface WorkspaceAttachment { workspaceId: string; sessionId: string }
export interface WorkspaceRecoveryResult { sessionId?: string; sessionReady?: boolean; error?: unknown }
type RecoverySessions = Pick<ISessions, 'create' | 'scope' | 'refresh'>
const recoveries = new Map<string, Promise<WorkspaceRecoveryResult>>()
export function pendingWorkspaceAttachment(draftKey: string): Promise<WorkspaceRecoveryResult> | undefined { return recoveries.get(draftKey) }

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
export async function sessionIsAddressable(sessions: Pick<ISessions, 'scope' | 'refresh'>, sessionId: string): Promise<boolean> {
  if (sessions.scope(sessionId)) return true
  try { await sessions.refresh() } catch { /* Keep the recovered identity even while list refresh is unavailable. */ }
  return sessions.scope(sessionId) !== undefined
}

export function clearWorkspaceOrigin(attachment: WorkspaceAttachment): void {
  const originKey = `new:${attachment.workspaceId}`
  if (readDraft(originKey).workspaceAttachment?.sessionId === attachment.sessionId) clearDraft(originKey)
}

/** Separate from sending: adopt the same published identity and retry only its Workspace attachment. */
export function retryWorkspaceAttachment(options: { draftKey: string; sessions: RecoverySessions }): Promise<WorkspaceRecoveryResult> {
  const active = recoveries.get(options.draftKey)
  if (active) return active
  const recovery = runRecovery(options).finally(() => {
    if (recoveries.get(options.draftKey) === recovery) recoveries.delete(options.draftKey)
  })
  recoveries.set(options.draftKey, recovery)
  return recovery
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
  try {
    // The Host adopts when sessionId is supplied. Never retry this operation with a fresh identity.
    const sessionId = await sessions.create({ workspaceId: attachment.workspaceId, sessionId: attachment.sessionId })
    if (sessionId !== attachment.sessionId) throw new Error('登録した会話を確認できませんでした。')
    const sessionReady = await sessionIsAddressable(sessions, sessionId)
    const current = readDraft(draftKey)
    if (!sessionReady) {
      writeDraft(`session:${sessionId}`, current)
      return { sessionId, sessionReady, error: new Error('会話の一覧を更新できませんでした。もう一度お試しください。') }
    }
    const { workspaceAttachment: _attachment, workspaceAttachmentError: _attachmentError, ...rest } = current
    writeDraft(`session:${sessionId}`, rest)
    if (draftKey !== `session:${sessionId}`) clearDraft(draftKey)
    clearWorkspaceOrigin(attachment)
    return { sessionId, sessionReady }
  } catch (error) {
    const sessionReady = await sessionIsAddressable(sessions, attachment.sessionId)
    if (draftKey !== `session:${attachment.sessionId}`) {
      writeDraft(`session:${attachment.sessionId}`, readDraft(draftKey))
      if (sessionReady) clearDraft(draftKey)
    }
    return { sessionId: attachment.sessionId, sessionReady, error }
  }
}
