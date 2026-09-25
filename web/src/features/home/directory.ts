import { useEffect, useState } from 'react'
import type { DshRemote, RemoteResult } from '../../dsh/services.ts'
import { remoteFailureOf, unwrapRemoteResult } from '../../dsh/remote-result.ts'

export interface DirectoryEntry { name: string; path: string; hidden: boolean }
export interface DirectoryListing { path: string; home: string; crumbs: DirectoryEntry[]; entries: DirectoryEntry[]; truncated: boolean }
export interface DirectoryPicker {
  list(path: string | undefined, signal?: AbortSignal): Promise<RemoteResult<DirectoryListing>>
  createDirectory(path: string, name: string): Promise<RemoteResult<string>>
}
export const nativeUnavailableMessage = 'この DSH は端末のフォルダ選択だけに対応しているため、iPhone などのブラウザからワークスペースを追加できません。'

export function directoryPicker(remote: DshRemote): DirectoryPicker | undefined {
  const value = remote.directoryPicker as Partial<DirectoryPicker> | undefined
  return value && typeof value.list === 'function' ? value as DirectoryPicker : undefined
}
export function isNativeUnavailable(error: unknown): boolean {
  const failure = remoteFailureOf(error)
  return failure?.code === 'directory-picker/unavailable' && failure.details.capability === 'native'
}

export interface DirectoryAvailability { ready: boolean; canAdd: boolean; homePath?: string }
function failedAvailability(error: unknown): DirectoryAvailability {
  return { ready: true, canAdd: isNativeUnavailable(error) || remoteFailureOf(error)?.code === 'directory-picker/unreadable' }
}
export async function probeDirectory(remote: DshRemote, signal?: AbortSignal): Promise<DirectoryAvailability> {
  const picker = directoryPicker(remote)
  if (!picker) return { ready: true, canAdd: false }
  try {
    const listing = unwrapRemoteResult(await picker.list(undefined, signal))
    return { ready: true, canAdd: true, homePath: listing.home }
  } catch (error) { return failedAvailability(error) }
}

/** The public RPC has no capability() method; probe its read-only browse operation. */
export function useDirectoryAvailability(remote: DshRemote, connected: boolean) {
  const [state, setState] = useState<DirectoryAvailability>({ ready: false, canAdd: false })
  useEffect(() => {
    if (!connected) return
    const controller = new AbortController()
    void probeDirectory(remote, controller.signal).then(next => { if (!controller.signal.aborted) setState(next) })
    return () => controller.abort()
  }, [remote, connected])
  return state
}
