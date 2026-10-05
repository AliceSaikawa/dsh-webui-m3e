import type { ProviderRemote, KeyInfo } from './providers.ts'

export type KeyReferenceReader = (ref: string) => Promise<KeyInfo | undefined>

/** Failure to verify a new destination must never authorize an overwrite. */
export async function inspectCustomKey(_remote: Pick<ProviderRemote, 'settings' | 'llm'>, _ref: string): Promise<KeyInfo | undefined> {
  // The RPC binding is awaiting handoff-issue16-07.md. Fail closed until applied.
  return undefined
}
