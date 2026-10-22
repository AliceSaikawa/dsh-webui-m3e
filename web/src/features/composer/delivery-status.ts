import { remoteFailureOf } from '../../dsh/remote-result.ts'
import { composerText } from './messages.ts'

/** The text of a prompt whose outcome cannot be proven; made in the page language when read. */
export function uncertainDeliveryMessage(): string {
  return composerText().uncertainDelivery
}

/** Gateway maps carrier loss and Host faults to the same internal code. */
export function promptOutcomeIsUnknown(error: unknown): boolean {
  const failure = remoteFailureOf(error)
  return failure === undefined || failure.code === 'gateway/internal' || failure.code === 'gateway/cancelled'
}

/** Only created after invoking prompt, never for model/command preparation. */
export class UncertainPromptError extends Error {
  constructor(cause: unknown) {
    super(uncertainDeliveryMessage(), { cause })
    this.name = 'UncertainPromptError'
  }
}
