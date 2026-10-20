import { messagesOf, type Translation } from '../i18n/catalog.ts'
import { currentLocale } from '../i18n/current.ts'
import { remoteErrorMessages } from './messages.ts'
import type { RemoteFailure, RemoteResult } from './services.ts'

export function isRemoteFailure(value: unknown): value is RemoteFailure {
  if (typeof value !== 'object' || value === null) return false
  const error = value as Partial<RemoteFailure>
  return typeof error.code === 'string' && typeof error.message === 'string'
    && typeof error.details === 'object' && error.details !== null
}

/** Both result errors and controller-thrown {rpcError} use the same UI text. */
export function remoteFailureOf(value: unknown): RemoteFailure | undefined {
  if (isRemoteFailure(value)) return value
  if (typeof value !== 'object' || value === null) return undefined
  const wrapped = value as { rpcError?: unknown; error?: unknown }
  if (isRemoteFailure(wrapped.rpcError)) return wrapped.rpcError
  if (isRemoteFailure(wrapped.error)) return wrapped.error
  return undefined
}

export type RemoteErrorTexts = Translation<typeof remoteErrorMessages.ja>

/** Host failure code to the dictionary key of its message. */
export const REMOTE_CODE_KEYS = {
  'gateway/bad-request': 'badRequest',
  'gateway/internal': 'gatewayInternal',
  'session/not-found': 'sessionNotFound',
  'session/title-invalid': 'sessionTitleInvalid',
  'session/agent-busy': 'sessionAgentBusy',
  'session/model-unavailable': 'sessionModelUnavailable',
  'session/provider-models-unavailable': 'providerModelsUnavailable',
  'session/projections-unavailable': 'projectionsUnavailable',
  'session/writer-held': 'writerHeld',
  'session/fork-unavailable': 'forkUnavailable',
  'session/queue-item-not-found': 'queueItemNotFound',
  'session/steer-unavailable': 'steerUnavailable',
  'session/attachment-invalid': 'attachmentInvalid',
  'workspace/invalid-path': 'workspaceInvalidPath',
  'workspace/name-conflict': 'workspaceNameConflict',
  'workspace/move-invalid': 'workspaceMoveInvalid',
  'session/provider-credentials-unavailable': 'credentialsUnavailable',
  'workspace/session-active': 'workspaceSessionActive',
  'workspace-file/watch-unsupported': 'watchUnsupported',
  'directory-picker/unavailable': 'pickerUnavailable',
  'directory-picker/unreadable': 'pickerUnreadable',
  'directory-picker/exists': 'pickerExists',
  'directory-picker/create-failed': 'pickerCreateFailed',
} as const satisfies Record<string, keyof RemoteErrorTexts>

/**
 * The visible text for a failure, in the page language (`text` is for tests).
 * Host diagnostics may be English and are never shown; a failure with no
 * message of its own gets `fallback`, or a general one.
 */
export function remoteErrorMessage(error: unknown, fallback?: string, text: RemoteErrorTexts = messagesOf(remoteErrorMessages, currentLocale())): string {
  const failure = remoteFailureOf(error)
  if (failure === undefined) {
    if (error instanceof Error && error.name === 'AbortError') return text.cancelled
    return fallback ?? text.failed
  }
  if (Object.hasOwn(REMOTE_CODE_KEYS, failure.code)) return text[REMOTE_CODE_KEYS[failure.code as keyof typeof REMOTE_CODE_KEYS]]
  if (/abort|cancelled/.test(failure.code)) return text.cancelled
  if (/disconnect|unavailable|transport|connection/.test(failure.code)) return text.disconnected
  if (/timeout/.test(failure.code)) return text.timeout
  return fallback ?? text.failed
}

export class RemoteCallError extends Error {
  readonly rpcError: RemoteFailure
  constructor(error: RemoteFailure) {
    super(remoteErrorMessage(error))
    this.name = 'RemoteCallError'
    this.rpcError = error
  }
}

export function unwrapRemoteResult<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new RemoteCallError(result.error)
  return result.value
}
