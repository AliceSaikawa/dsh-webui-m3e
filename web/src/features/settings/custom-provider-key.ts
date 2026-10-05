import { keyInfo, type ProviderRemote, type KeyInfo } from './providers.ts'

export type KeyReferenceReader = (ref: string) => Promise<KeyInfo | undefined>

/** Failure to verify a new destination must never authorize an overwrite. */
export async function inspectCustomKey(remote: Pick<ProviderRemote, 'settings' | 'llm'>, ref: string): Promise<KeyInfo | undefined> {
  try {
    const answer = await (remote as ProviderRemote).credentials.describe([ref])
    return answer.ok && Object.hasOwn(answer.value, ref) ? keyInfo(answer.value[ref]) : undefined
  } catch { return undefined }
}
