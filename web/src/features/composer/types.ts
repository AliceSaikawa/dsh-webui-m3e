import type { PendingSubmissionAttachment, PromptContentPart } from '../../dsh/services.ts'

/** Shared with Node tests without importing browser image decoding. */
export interface PreparedImage {
  id: string
  name: string
  previewUrl: string
  width: number
  height: number
  prompt: Extract<PromptContentPart, { type: 'image' }>
  attachment: Extract<PendingSubmissionAttachment, { type: 'image' }>
}
