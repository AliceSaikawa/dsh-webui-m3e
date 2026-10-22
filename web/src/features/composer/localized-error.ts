import { remoteErrorMessage, remoteFailureOf, RemoteCallError } from '../../dsh/remote-result.ts'
import { composerText, type ComposerMessages } from './messages.ts'

/**
 * A failure whose message M3E wrote in the page language. `errorText` shows
 * only these messages as they are; any other `Error` may carry Host or library
 * text in another language, so it is replaced with a fixed message.
 */
export class LocalizedError extends Error {}

/**
 * The visible text for a failure. A `LocalizedError` already carries its
 * message in the page language; a Host failure goes through the shared
 * translator. Any other error may hold text in another language (a provider's
 * raw message, a library error), so it shows the fallback instead.
 */
export function errorText(error: unknown, fallback?: string, text: ComposerMessages = composerText()): string {
  if (error instanceof LocalizedError) return error.message || fallback || text.errorFailed
  if (error instanceof RemoteCallError || remoteFailureOf(error) !== undefined) return remoteErrorMessage(error, fallback)
  if (error instanceof Error && error.name === 'AbortError') return remoteErrorMessage(error, fallback)
  return fallback ?? text.errorFailed
}
