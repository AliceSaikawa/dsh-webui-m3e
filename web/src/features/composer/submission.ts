import type { ISession, PromptContentPart } from '../../dsh/services.ts'
import type { PreparedImage } from './types.ts'
import type { CommandDescriptor } from './api.ts'
import { unwrapRemoteResult } from '../../dsh/remote-result.ts'
import { isKnownCommand } from './helpers.ts'

export async function submitMessage(face: ISession, text: string, images: readonly PreparedImage[], mode: 'queue' | 'steer', commands: readonly CommandDescriptor[]): Promise<void> {
  if (!text.trim() && !images.length) throw new Error('メッセージか画像を追加してください。')
  if (isKnownCommand(text, commands)) {
    if (images.length) throw new Error('コマンドと画像は同時に送れません。画像を外してから実行してください。')
    const result = unwrapRemoteResult(await face.command(text))
    if (result.matched) return
    // A command can disappear between listing and sending. Treat it as text.
  }
  const submission = face.beginSubmission({ mode, text, attachments: images.map(image => image.attachment) })
  try {
    const content: PromptContentPart[] = images.map(image => image.prompt)
    if (text) content.push({ type: 'text', text })
    unwrapRemoteResult(await face.prompt(content, mode, undefined, submission.requestId))
  } catch (error) {
    submission.abandon()
    throw error
  }
}
