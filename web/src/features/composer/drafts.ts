import type { PreparedImage } from './types.ts'
import type { ModelSelection } from './api.ts'

export interface Draft {
  text: string
  images: PreparedImage[]
  model?: ModelSelection
  permission?: string
  plan?: boolean
  retryMode?: 'queue' | 'steer'
  error?: string
}
const drafts = new Map<string, Draft>()
const prefix = 'm3e:composer:'
function storage() { return 'window' in globalThis ? globalThis.localStorage : undefined }

/** Text survives reloads; image bytes and choices stay in this tab only. */
export function readDraft(key: string): Draft {
  const cached = drafts.get(key)
  if (cached) return cached
  let text = ''
  try { text = storage()?.getItem(prefix + key) ?? '' } catch { /* Storage can be unavailable. */ }
  const draft = { text, images: [] }
  drafts.set(key, draft)
  return draft
}
export function writeDraft(key: string, draft: Draft): void {
  drafts.set(key, draft)
  try {
    if (draft.text) storage()?.setItem(prefix + key, draft.text)
    else storage()?.removeItem(prefix + key)
  } catch { /* Keep the in-memory draft when storage is full or disabled. */ }
}
export function clearDraft(key: string): void { writeDraft(key, { text: '', images: [] }) }
