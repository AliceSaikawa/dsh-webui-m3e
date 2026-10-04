import type { ISessions, SessionFace, SessionReference } from '../../dsh/services.ts'
import { sessionAccess } from '../../dsh/session-access.ts'
import { requireMatched, type composerApi, type PlanProjection } from './api.ts'
import { clearDraft, readDraft, writeDraft } from './drafts.ts'
import { submitMessage } from './submission.ts'
import { uncertainDeliveryMessage, UncertainPromptError } from './delivery-status.ts'
import { clearWorkspaceOrigin, sessionIsAddressable, workspaceAttachmentFrom } from './workspace-recovery.ts'

export type DeliveryTarget = { kind: 'session'; sessionId: string } | { kind: 'new'; workspaceId: string }
export interface DeliveryOptions {
  target: DeliveryTarget
  draftKey: string
  sessions: Pick<ISessions, 'create' | 'retain' | 'subagentAddress' | 'refresh' | 'list'>
  api: Pick<ReturnType<typeof composerApi>, 'selectModel' | 'listCommands'>
  mode: 'queue' | 'steer'
}
export interface DeliveryResult { createdId?: string; sessionReady?: boolean; error?: unknown }

// A remounted composer joins the in-flight send instead of creating another session.
const flights = new Map<string, Promise<DeliveryResult>>()
const flightKeys = new Map<Promise<DeliveryResult>, Set<string>>()
function shareKey(key: string, flight: Promise<DeliveryResult>): void {
  const existing = flights.get(key)
  if (existing && existing !== flight) throw new Error('この会話の送信が完了してから、もう一度お試しください。')
  flights.set(key, flight)
  const keys = flightKeys.get(flight) ?? new Set<string>()
  keys.add(key)
  flightKeys.set(flight, keys)
}
export function pendingDelivery(draftKey: string): Promise<DeliveryResult> | undefined {
  let active = flights.get(draftKey)
  if (!active && draftKey.startsWith('new:')) {
    const retained = readDraft(draftKey).workspaceAttachment
    const valid = retained && workspaceAttachmentFrom({ code: 'session/workspace-attach-failed', details: retained }, draftKey.slice(4))
    if (valid) active = flights.get(`session:${valid.sessionId}`)
    if (active) shareKey(draftKey, active)
  }
  return active
}

export function deliverDraft(options: DeliveryOptions): Promise<DeliveryResult> {
  const active = pendingDelivery(options.draftKey)
  if (active) return active
  const keys = new Set([options.draftKey])
  const flight = runDelivery(options, key => {
    keys.add(key)
    const original = flights.get(options.draftKey)
    if (original) shareKey(key, original)
  }).finally(() => {
    for (const key of flightKeys.get(flight) ?? keys) if (flights.get(key) === flight) flights.delete(key)
    flightKeys.delete(flight)
  })
  // Retained creation IDs can register synchronously before runDelivery awaits.
  for (const key of keys) shareKey(key, flight)
  return flight
}

function ensureWritable(face: SessionFace, sessions: DeliveryOptions['sessions']) {
  const snapshot = face.getSnapshot()
  const access = sessionAccess(sessions.list.getSnapshot().byId[face.sessionId], snapshot)
  if (!access.canCompose) throw new Error('サブエージェントの会話は読むだけです。')
  if (snapshot.removed) throw new Error('この会話は削除されています。')
  return access
}

async function runDelivery({ target, draftKey, sessions, api, mode }: DeliveryOptions, shareFlight: (key: string) => void): Promise<DeliveryResult> {
  if ((readDraft(draftKey).preparingImages ?? 0) > 0) {
    return { error: new Error('画像を準備しています。準備が終わってから送信してください。') }
  }
  const currentDraft = readDraft(draftKey)
  // A failed retry cannot establish what happened to the earlier request.
  let sending = { ...currentDraft, retryMode: mode, error: currentDraft.deliveryOutcome === 'unknown' ? uncertainDeliveryMessage : undefined as string | undefined }
  let createdId: string | undefined
  let sessionReady = true
  let reference: SessionReference | undefined
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
    if (createdId) {
      shareFlight(`session:${createdId}`)
      writeDraft(`session:${createdId}`, sending)
    }
    reference = sessions.retain(sessions.subagentAddress(sessionId) ?? sessionId, { source: 'm3e.delivery' })
    const destination = (await reference.ready).session
    if (destination.getSnapshot().openState === 'error') throw new Error('会話を準備できませんでした。会話を開き直してから送信してください。')
    ensureWritable(destination, sessions)

    if (sending.model) {
      await api.selectModel(sessionId, sending.model)
      ensureWritable(destination, sessions)
    }
    if (sending.permission) {
      requireMatched(await destination.command(`/permission ${sending.permission}`))
      ensureWritable(destination, sessions)
    }
    if (sending.plan !== undefined) {
      const plan = destination.projections.faceOf('plan').getSnapshot() as PlanProjection | undefined
      const active = typeof plan?.active === 'boolean' ? (plan.pending ? !plan.active : plan.active) : undefined
      // /plan is a toggle. A failed first prompt must not toggle an already-applied choice off on retry.
      if (active !== sending.plan) {
        requireMatched(await destination.command(sending.plan ? '/plan' : '/plan off'))
        ensureWritable(destination, sessions)
      }
    }
    const available = sending.text.startsWith('/') ? await api.listCommands(sessionId) : []
    ensureWritable(destination, sessions)
    await submitMessage(destination, sending.text, sending.images, mode, available, {
      // The installed child SDK replaces the registered id on the wire, so a
      // local echo cannot retire against its durable event. Keep child display
      // authoritative while retaining optimistic echoes for normal sessions.
      beforePrompt: () => ({ optimisticEcho: !ensureWritable(destination, sessions).isSubagent }),
    })
    clearDeliveredDraft(draftKey, sending)
    if (createdId) clearDeliveredDraft(`session:${createdId}`, sending)
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
    const unknown = error instanceof UncertainPromptError || sending.deliveryOutcome === 'unknown'
    const failed = { ...sending, error: unknown ? uncertainDeliveryMessage : message,
      deliveryOutcome: unknown ? 'unknown' as const : undefined }
    writeDraft(createdId ? `session:${createdId}` : draftKey, failed)
    if (createdId && !sessionReady) writeDraft(draftKey, failed)
    return { createdId, ...(createdId && sending.workspaceAttachment ? { sessionReady } : {}), error }
  } finally {
    reference?.release()
    // Once creation succeeded, retries belong to that session even if preparation or sending failed.
    if (createdId && sessionReady) clearDraft(draftKey)
  }
}

function clearDeliveredDraft(draftKey: string, sent: ReturnType<typeof readDraft>): void {
  const attachment = readDraft(draftKey).workspaceAttachment
  clearDraft(draftKey)
  // Sending a prompt does not repair Workspace registration or dismiss its separate recovery action.
  if (attachment) writeDraft(draftKey, { text: '', images: [], workspaceAttachment: attachment })
  if (attachment && draftKey.startsWith('session:')) clearWorkspaceOrigin(attachment, sent)
}
