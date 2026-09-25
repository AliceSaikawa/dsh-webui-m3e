import type { ISessions, SessionFace } from '../../dsh/services.ts'
import { requireMatched, type composerApi, type PlanProjection } from './api.ts'
import { clearDraft, readDraft, writeDraft } from './drafts.ts'
import { submitMessage } from './submission.ts'

export type DeliveryTarget = { kind: 'session'; sessionId: string } | { kind: 'new'; workspaceId: string }
export interface DeliveryOptions {
  target: DeliveryTarget
  draftKey: string
  sessions: Pick<ISessions, 'create' | 'scope' | 'sessionOf'>
  api: Pick<ReturnType<typeof composerApi>, 'selectModel' | 'listCommands'>
  mode: 'queue' | 'steer'
}
export interface DeliveryResult { createdId?: string; error?: unknown }

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

function ensureWritable(face: SessionFace): void {
  const snapshot = face.getSnapshot()
  if (snapshot.subagent !== null) throw new Error('サブエージェントの会話は読むだけです。')
  if (snapshot.removed) throw new Error('この会話は削除されています。')
}

async function runDelivery({ target, draftKey, sessions, api, mode }: DeliveryOptions): Promise<DeliveryResult> {
  const sending = { ...readDraft(draftKey), retryMode: mode, error: undefined }
  let createdId: string | undefined
  try {
    if (!sending.text.trim() && !sending.images.length) throw new Error('メッセージか画像を追加してください。')
    writeDraft(draftKey, sending)
    const sessionId = target.kind === 'new'
      ? createdId = await sessions.create({ workspaceId: target.workspaceId })
      : target.sessionId
    if (createdId) writeDraft(`session:${createdId}`, sending)
    const scope = sessions.scope(sessionId)
    const destination = scope ? sessions.sessionOf(scope) : undefined
    if (!destination) throw new Error('会話を準備できませんでした。会話を開き直してから送信してください。')
    ensureWritable(destination)

    if (sending.model) await api.selectModel(sessionId, sending.model)
    if (sending.permission) requireMatched(await destination.command(`/permission ${sending.permission}`))
    if (sending.plan !== undefined) {
      const plan = destination.projections.faceOf('plan').getSnapshot() as PlanProjection | undefined
      const active = typeof plan?.active === 'boolean' ? (plan.pending ? !plan.active : plan.active) : undefined
      // /plan is a toggle. A failed first prompt must not toggle an already-applied choice off on retry.
      if (active !== sending.plan) requireMatched(await destination.command(sending.plan ? '/plan' : '/plan off'))
    }
    const available = sending.text.startsWith('/') ? await api.listCommands(sessionId) : []
    ensureWritable(destination)
    await submitMessage(destination, sending.text, sending.images, mode, available)
    clearDraft(draftKey)
    if (createdId) clearDraft(`session:${createdId}`)
    return createdId ? { createdId } : {}
  } catch (error) {
    const message = target.kind === 'new' && !createdId
      ? 'セッションを作れませんでした。接続とワークスペースを確認してください。'
      : 'メッセージを送れませんでした。接続を確認して、もう一度お試しください。'
    writeDraft(createdId ? `session:${createdId}` : draftKey, { ...sending, error: message })
    return { createdId, error }
  } finally {
    // Once creation succeeded, retries belong to that session even if preparation or sending failed.
    if (createdId) clearDraft(draftKey)
  }
}
