import { unwrapRemoteResult } from '../../dsh/remote-result.ts'
import type { QueuedMessage, SessionFace } from '../../dsh/services.ts'
import { messagesOf } from '../../i18n/catalog.ts'
import { composerMessages, type ComposerMessages } from './messages.ts'

export function queueEditPrompt(
  face: Pick<SessionFace, 'updateQueue'>,
  item: Pick<QueuedMessage, 'id' | 'text' | 'content'>,
  close: () => void,
  text: ComposerMessages = messagesOf(composerMessages, 'ja'),
) {
  return {
    title: text.queueEditTitle,
    label: item.content.some(part => part.type !== 'text')
      ? text.queueEditWithImages
      : text.queueEditMessage,
    initialValue: item.text ?? '',
    multiline: true,
    rows: 3,
    onCancel: close,
    async onConfirm(text: string) {
      // Leave failures to TextPromptDialog so the edited text stays available for retry.
      unwrapRemoteResult(await face.updateQueue(item.id, { kind: 'edit', content: [{ type: 'text', text }] }))
      close()
    },
  }
}
