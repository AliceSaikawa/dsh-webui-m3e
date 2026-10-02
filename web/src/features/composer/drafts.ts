import type { PreparedImage } from './types.ts'
import type { ModelSelection } from './api.ts'
import { uncertainDeliveryMessage } from './delivery-status.ts'

export interface Draft {
  text: string
  images: PreparedImage[]
  model?: ModelSelection
  permission?: string
  plan?: boolean
  retryMode?: 'queue' | 'steer'
  preparingImages?: number
  imagePreparationError?: unknown
  workspaceAttachment?: { workspaceId: string; sessionId: string }
  workspaceAttachmentError?: string
  error?: string
  deliveryOutcome?: 'unknown'
}
const drafts = new Map<string, Draft>()
const listeners = new Map<string, Set<() => void>>()
const preparations = new Map<string, Map<symbol, number>>()
const prefix = 'm3e:composer:'
const attachmentKey = (key: string) => prefix + key + ':workspaceAttachment'
const outcomeKey = (key: string) => prefix + key + ':deliveryOutcome'
function storage() { return 'window' in globalThis ? globalThis.localStorage : undefined }

export function subscribeDraft(key: string, listener: () => void): () => void {
  let subscribers = listeners.get(key)
  if (!subscribers) { subscribers = new Set(); listeners.set(key, subscribers) }
  subscribers.add(listener)
  return () => {
    subscribers.delete(listener)
    if (!subscribers.size) listeners.delete(key)
  }
}

/** Text and recovery IDs survive reloads; image bytes and choices stay in this tab only. */
export function readDraft(key: string): Draft {
  const cached = drafts.get(key)
  if (cached) return cached
  let text = ''
  let workspaceAttachment: Draft['workspaceAttachment']
  let deliveryOutcome: Draft['deliveryOutcome']
  try { text = storage()?.getItem(prefix + key) ?? '' } catch { /* Storage can be unavailable. */ }
  try { if (storage()?.getItem(outcomeKey(key)) === 'unknown') deliveryOutcome = 'unknown' } catch { /* Keep text usable without metadata. */ }
  try {
    const saved: unknown = JSON.parse(storage()?.getItem(attachmentKey(key)) ?? 'null')
    if (typeof saved === 'object' && saved !== null) {
      const value = saved as Record<string, unknown>
      if (typeof value.sessionId === 'string' && value.sessionId.trim() && typeof value.workspaceId === 'string' && value.workspaceId.trim()
        && (!key.startsWith('session:') || key === `session:${value.sessionId}`)) {
        workspaceAttachment = { sessionId: value.sessionId, workspaceId: value.workspaceId }
      }
    }
  } catch { /* Ignore unavailable or malformed recovery metadata. */ }
  const draft: Draft = { text, images: [], ...(workspaceAttachment ? { workspaceAttachment } : {}),
    ...(deliveryOutcome ? { deliveryOutcome, error: uncertainDeliveryMessage } : {}) }
  drafts.set(key, draft)
  return draft
}
export function writeDraft(key: string, draft: Draft): void {
  drafts.set(key, draft)
  try {
    if (draft.deliveryOutcome === 'unknown') storage()?.setItem(outcomeKey(key), 'unknown')
    else storage()?.removeItem(outcomeKey(key))
    if (draft.workspaceAttachment) storage()?.setItem(attachmentKey(key), JSON.stringify(draft.workspaceAttachment))
    else storage()?.removeItem(attachmentKey(key))
    if (draft.text) storage()?.setItem(prefix + key, draft.text)
    else storage()?.removeItem(prefix + key)
  } catch { /* Keep the in-memory draft when storage is full or disabled. */ }
  listeners.get(key)?.forEach(listener => listener())
}
export function clearDraft(key: string): void {
  preparations.delete(key)
  writeDraft(key, { text: '', images: [] })
}

/** Preparation belongs to the draft, so a remounted view sees both progress and results. */
export async function prepareDraftImages<Input>(key: string, inputs: readonly Input[], prepare: (input: Input) => Promise<PreparedImage>): Promise<void> {
  if (!inputs.length) return
  let pending = preparations.get(key)
  if (!pending) { pending = new Map(); preparations.set(key, pending) }
  const token = Symbol()
  pending.set(token, inputs.length)
  const count = () => [...pending.values()].reduce((sum, value) => sum + value, 0)
  writeDraft(key, { ...readDraft(key), preparingImages: count(), imagePreparationError: undefined })
  const results = await Promise.allSettled(inputs.map(input => Promise.resolve().then(() => prepare(input))))
  // Clearing/sending the draft invalidates unfinished work; it cannot append to a later draft.
  if (preparations.get(key) !== pending || !pending.delete(token)) return
  const remaining = count()
  if (!remaining) preparations.delete(key)
  const current = readDraft(key)
  const added = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
  const failed = results.find(result => result.status === 'rejected')
  writeDraft(key, { ...current, images: [...current.images, ...added], preparingImages: remaining,
    imagePreparationError: failed?.status === 'rejected' ? failed.reason : current.imagePreparationError })
}
