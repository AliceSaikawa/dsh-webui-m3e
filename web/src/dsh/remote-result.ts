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

const messages: Record<string, string> = {
  'session/not-found': '会話が見つかりません。',
  'session/title-invalid': '会話の題名を入力してください。',
  'session/agent-busy': '実行中の処理が終わってから、もう一度お試しください。',
  'session/model-unavailable': '選んだモデルを利用できません。モデルを選び直してください。',
  'session/fork-unavailable': 'この位置からは会話を分岐できません。',
  'session/queue-item-not-found': 'このメッセージはすでに順番待ちから外れています。',
  'session/steer-unavailable': 'このメッセージでは実行中の処理に割り込めません。',
  'session/attachment-invalid': '添付ファイルを送れません。内容やサイズを確認してください。',
  'workspace/invalid-path': 'このフォルダを利用できません。パスを確認してください。',
  'workspace/name-conflict': '同じ名前のワークスペースがあります。',
  'workspace/move-invalid': 'この場所には移動できません。',
  'directory-picker/unavailable': 'フォルダの選択を利用できません。',
  'directory-picker/unreadable': 'このフォルダを読み取れません。',
  'directory-picker/exists': '同じ名前のフォルダがすでにあります。',
  'directory-picker/create-failed': 'フォルダを作れませんでした。',
}

/** Host diagnostics may be English; visible fallback messages stay Japanese. */
export function remoteErrorMessage(error: unknown, fallback = '処理に失敗しました。もう一度お試しください。'): string {
  const failure = remoteFailureOf(error)
  if (failure === undefined) {
    if (error instanceof Error && error.name === 'AbortError') return '操作を取り消しました。'
    return fallback
  }
  if (messages[failure.code] !== undefined) return messages[failure.code]!
  if (/abort|cancelled/.test(failure.code)) return '操作を取り消しました。'
  if (/disconnect|unavailable|transport|connection/.test(failure.code)) return '接続できません。接続を確認して、もう一度お試しください。'
  if (/timeout/.test(failure.code)) return '応答を待ちきれませんでした。もう一度お試しください。'
  return fallback
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
