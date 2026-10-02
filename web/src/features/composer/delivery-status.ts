import { remoteFailureOf } from '../../dsh/remote-result.ts'

export const uncertainDeliveryMessage = '送信結果を確認できませんでした。会話や順番待ちを確認してから、必要ならもう一度送ってください。同じ内容が重複して届く可能性があります。'

/** Gateway maps carrier loss and Host faults to the same internal code. */
export function promptOutcomeIsUnknown(error: unknown): boolean {
  const failure = remoteFailureOf(error)
  return failure === undefined || failure.code === 'gateway/internal' || failure.code === 'gateway/cancelled'
}

/** Only created after invoking prompt, never for model/command preparation. */
export class UncertainPromptError extends Error {
  constructor(cause: unknown) {
    super(uncertainDeliveryMessage, { cause })
    this.name = 'UncertainPromptError'
  }
}
