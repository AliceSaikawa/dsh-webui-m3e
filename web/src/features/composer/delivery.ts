import type { ISessions, SessionFace } from '../../dsh/services.ts'
import { sessionAccess } from '../../dsh/session-access.ts'
import { requireMatched, type composerApi, type PlanProjection } from './api.ts'
import { clearDraft, readDraft, writeDraft } from './drafts.ts'
import { submitMessage } from './submission.ts'
import { clearWorkspaceOrigin, sessionIsAddressable, workspaceAttachmentFrom } from './workspace-recovery.ts'

export type DeliveryTarget = { kind: 'session'; sessionId: string } | { kind: 'new'; workspaceId: string }
export interface DeliveryOptions {
  target: DeliveryTarget
  draftKey: string
  sessions: Pick<ISessions, 'create' | 'scope' | 'sessionOf' | 'refresh' | 'list'>
  api: Pick<ReturnType<typeof composerApi>, 'selectModel' | 'listCommands'>
  mode: 'queue' | 'steer'
}
export interface DeliveryResult { createdId?: string; sessionReady?: boolean; error?: unknown }

// A remounted composer joins the in-flight send instead of creating another session.
const flights = new Map<string, Promise<DeliveryResult>>()
export function pendingDelivery(draftKey: string): Promise<DeliveryResult> | undefined { return flights.get(draftKey) }

export function deliverDraft(options: DeliveryOptions): Promise<DeliveryResult> {
  const active = flights.get(options.draftKey)
  if (active) return active
  const flight = runDelivery(options).finally(() => {
    if (flights.get(options.draftKey) === flight) flights.delete(options.draftKey)
  })
  flights.set(options.draftKey, flight)
  return flight
}

function ensureWritable(face: SessionFace, sessions: DeliveryOptions['sessions']): void {
  const snapshot = face.getSnapshot()
  if (!sessionAccess(sessions.list.getSnapshot().byId[face.sessionId], snapshot).canCompose) throw new Error('サブエージェントの会話は読むだけです。')
  if (snapshot.removed) throw new Error('この会話は削除されています。')
}

async function runDelivery({ target, draftKey, sessions, api, mode }: DeliveryOptions): Promise<DeliveryResult> {
  if ((readDraft(draftKey).preparingImages ?? 0) > 0) {
    return { error: new Error('画像を準備しています。準備が終わってから送信してください。') }
  }
  let sending = { ...readDraft(draftKey), retryMode: mode, error: undefined as string | undefined }
  let createdId: string | undefined
  let sessionReady = true
  try {
    if (!sending.text.trim() && !sending.images.length) throw new Error('メッセージか画像を追加してください。')
    writeDraft(draftKey, sending)
    let sessionId: string
    if (target.kind === 'new') {
      const retained = sending.workspaceAttachment
      if (retained && !workspaceAttachmentFrom({ code: 'session/workspace-attach-failed', details: retained }, target.workspaceId)) {
        throw new Error('作成済みの会話を確認できませんでした。会話の一覧から開き直してください。')
      }
      createdId = retained
        ? retained.sessionId
        : await sessions.create({ workspaceId: target.workspaceId })
      sessionId = createdId
    } else sessionId = target.sessionId
    if (createdId) writeDraft(`session:${createdId}`, sending)
    const scope = sessions.scope(sessionId)
    const destination = scope ? sessions.sessionOf(scope) : undefined
    if (!destination) throw new Error('会話を準備できませんでした。会話を開き直してから送信してください。')
    ensureWritable(destination, sessions)

    if (sending.model) await api.selectModel(sessionId, sending.model)
    if (sending.permission) requireMatched(await destination.command(`/permission ${sending.permission}`))
    if (sending.plan !== undefined) {
      const plan = destination.projections.faceOf('plan').getSnapshot() as PlanProjection | undefined
      const active = typeof plan?.active === 'boolean' ? (plan.pending ? !plan.active : plan.active) : undefined
      // /plan is a toggle. A failed first prompt must not toggle an already-applied choice off on retry.
      if (active !== sending.plan) requireMatched(await destination.command(sending.plan ? '/plan' : '/plan off'))
    }
    const available = sending.text.startsWith('/') ? await api.listCommands(sessionId) : []
    ensureWritable(destination, sessions)
    await submitMessage(destination, sending.text, sending.images, mode, available)
    clearDeliveredDraft(draftKey)
    if (createdId) clearDeliveredDraft(`session:${createdId}`)
    return createdId ? { createdId } : {}
  } catch (error) {
    const attachmentFailure = target.kind === 'new' ? workspaceAttachmentFrom(error, target.workspaceId) : undefined
    if (target.kind === 'new' && !createdId) {
      const attachment = attachmentFailure
      if (attachment) {
        createdId = attachment.sessionId
        sending = { ...sending, workspaceAttachment: attachment }
      }
    }
    if (createdId && sending.workspaceAttachment) sessionReady = await sessionIsAddressable(sessions, createdId)
    const message = attachmentFailure
      ? 'メッセージはまだ送信されていません。送信ボタンから送ってください。'
      : target.kind === 'new' && !createdId
      ? 'セッションを作れませんでした。接続とワークスペースを確認してください。'
      : 'メッセージを送れませんでした。接続を確認して、もう一度お試しください。'
    const failed = { ...sending, error: message }
    writeDraft(createdId ? `session:${createdId}` : draftKey, failed)
    if (createdId && !sessionReady) writeDraft(draftKey, failed)
    return { createdId, ...(createdId && sending.workspaceAttachment ? { sessionReady } : {}), error }
  } finally {
    // Once creation succeeded, retries belong to that session even if preparation or sending failed.
    if (createdId && sessionReady) clearDraft(draftKey)
  }
}

function clearDeliveredDraft(draftKey: string): void {
  const attachment = readDraft(draftKey).workspaceAttachment
  clearDraft(draftKey)
  // Sending a prompt does not repair Workspace registration or dismiss its separate recovery action.
  if (attachment) writeDraft(draftKey, { text: '', images: [], workspaceAttachment: attachment })
  if (attachment && draftKey.startsWith('session:')) clearWorkspaceOrigin(attachment)
}
