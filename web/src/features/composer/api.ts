import type { DshRemote, RemoteResult } from '../../dsh/services.ts'
import { unwrapRemoteResult } from '../../dsh/remote-result.ts'

/** Browser wire shapes verified against the installed DSH client plugins. */
export interface CommandDescriptor {
  readonly name: string
  readonly description: string
  readonly input?: { readonly hint: string; readonly attachments?: boolean }
}
export interface FileReference { readonly path: string; readonly kind: 'file' | 'directory' }
export interface ModelSelection { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }
export interface ModelReasoningEffort { readonly id: string; readonly name: string; readonly description?: string }
export interface ModelCatalogModel {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly reasoning?: { readonly efforts: readonly ModelReasoningEffort[]; readonly defaultEffort?: string }
}
export interface ModelCatalog {
  readonly default: ModelSelection
  readonly routableProviders: readonly string[]
  readonly groups: readonly { readonly id: string; readonly name: string; readonly models: readonly ModelCatalogModel[] }[]
  readonly failures: readonly { readonly id: string; readonly name: string; readonly message: string }[]
}
export interface ModelSelectionProjection { readonly lastUsed: ModelSelection | null; readonly next: ModelSelection | null }
export interface PermissionOption { readonly value: string; readonly name: string; readonly description?: string }
export interface PermissionProjection { readonly options: readonly PermissionOption[]; readonly currentValue: string }
export interface PlanProjection { readonly active: boolean; readonly pending: boolean }

interface ComposerRemote {
  readonly commands?: { list(sessionId: string): Promise<RemoteResult<readonly CommandDescriptor[]>> }
  readonly fileReferences?: { list(sessionId: string, query: string, signal: AbortSignal): Promise<RemoteResult<readonly FileReference[]>> }
  readonly session?: {
    modelCatalog(): Promise<RemoteResult<ModelCatalog>>
    selectModel(input: ModelSelection & { sessionId: string }): Promise<RemoteResult<{ selected: ModelSelection }>>
  }
  readonly settings?: { describe(): Promise<RemoteResult<{ readonly namespaces: readonly SettingsNamespace[] }>> }
  $on?(event: 'commands/change', listener: () => void): unknown
}

export interface SettingsNamespace { readonly ns: string; readonly schema: unknown; readonly value: unknown }
type RecordValue = Record<string, unknown>
const record = (value: unknown): RecordValue | undefined => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as RecordValue : undefined

export function requireMatched(result: RemoteResult<{ matched: boolean }>): void {
  if (!unwrapRemoteResult(result).matched) throw new Error('この会話では、そのコマンドを使えません。')
}

/** Read only the advertised preset enum; never evaluate serialized schema callbacks. */
export function permissionDefaultsOf(view: SettingsNamespace | undefined): PermissionProjection | undefined {
  if (!view) return undefined
  const currentValue = record(view.value)?.defaultPreset
  const envelope = record(view.schema)
  const refs = record(envelope?.refs)
  const nodeOf = (value: unknown): RecordValue | undefined => typeof value === 'number' || typeof value === 'string'
    ? record(refs?.[String(value)]) : record(value)
  const root = refs ? nodeOf(envelope?.uid) : envelope
  const node = root?.type === 'object' ? nodeOf(record(root.dict)?.defaultPreset) : undefined
  const candidates = node?.type === 'union' && Array.isArray(node.list) ? node.list : [node]
  const options = candidates.flatMap((candidate): PermissionOption[] => {
    const choice = nodeOf(candidate)
    if (choice?.type !== 'const' || typeof choice.value !== 'string' || choice.value === 'custom') return []
    const description = record(choice.meta)?.description
    return [{ value: choice.value, name: typeof description === 'string' && description.length > 0 ? description : choice.value }]
  })
  if (typeof currentValue !== 'string' || options.length === 0 || !options.some((option) => option.value === currentValue)) {
    throw new Error('新しい会話の権限候補を読み込めませんでした。')
  }
  return { currentValue, options }
}

/** Discovery never creates a Session; selectModel also asks the Host to save its default. */
export function composerApi(remote: DshRemote) {
  const wire = remote as ComposerRemote
  return {
    async listCommands(sessionId: string): Promise<readonly CommandDescriptor[]> {
      if (!wire.commands) throw new Error('コマンドの候補を取得できません。')
      return unwrapRemoteResult(await wire.commands.list(sessionId))
    },
    async listFiles(sessionId: string, query: string, signal: AbortSignal): Promise<readonly FileReference[]> {
      if (!wire.fileReferences) throw new Error('ファイルの候補を取得できません。')
      return unwrapRemoteResult(await wire.fileReferences.list(sessionId, query, signal))
    },
    async modelCatalog(): Promise<ModelCatalog> {
      if (!wire.session?.modelCatalog) throw new Error('モデルの一覧を取得できません。')
      return unwrapRemoteResult(await wire.session.modelCatalog())
    },
    async selectModel(sessionId: string, selection: ModelSelection): Promise<ModelSelection> {
      if (!wire.session?.selectModel) throw new Error('モデルを切り替えられません。')
      return unwrapRemoteResult(await wire.session.selectModel({ sessionId, ...selection })).selected
    },
    async defaultPermissions(): Promise<PermissionProjection | undefined> {
      if (!wire.settings?.describe) return undefined
      const value = unwrapRemoteResult(await wire.settings.describe())
      return permissionDefaultsOf(value.namespaces.find((view) => view.ns === 'permission'))
    },
    onCommandsChange(listener: () => void): () => void {
      let active = true
      const dispose = wire.$on?.('commands/change', () => { if (active) listener() })
      return () => { active = false; if (typeof dispose === 'function') dispose() }
    },
  }
}
