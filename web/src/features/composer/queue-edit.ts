import { unwrapRemoteResult } from '../../dsh/remote-result.ts'
import type { QueuedMessage, SessionFace } from '../../dsh/services.ts'

export function queueEditPrompt(
  face: Pick<SessionFace, 'updateQueue'>,
  item: Pick<QueuedMessage, 'id' | 'text' | 'content'>,
  close: () => void,
) {
  return {
    title: '順番待ちのメッセージを編集',
    label: item.content.some(part => part.type !== 'text')
      ? 'メッセージ（編集すると添付画像は外れます）'
      : 'メッセージ',
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
