import type { MockKit } from '../../dsh/mock/kit.ts'
import type { RemoteResult, SessionSummary } from '../../dsh/services.ts'
import type { CommandDescriptor, FileReference, ModelCatalog, ModelSelection, ModelSelectionProjection, PermissionCatalog, PermissionSelection } from './api.ts'
import type { SettingsMockRemote } from '../settings/mock.ts'

const success = <T>(value: T): RemoteResult<T> => ({ ok: true, value })
const failure = (code: string, message: string, details: Record<string, unknown> = {}): RemoteResult<never> => ({ ok: false, error: { code, message, details } })

export const mockCommands: readonly CommandDescriptor[] = [
  { name: 'model', description: 'この会話で使うモデルを選びます。' },
  { name: 'permission', description: 'この会話の権限を切り替えます。', input: { hint: '権限のプリセット名' } },
  { name: 'plan', description: '計画モードに切り替えます。off で終了します。', input: { hint: '計画したいこと、または off', attachments: true } },
]
export const mockPermissions: PermissionSelection = { currentValue: 'workspace-write' }
export const mockPermissionCatalog: PermissionCatalog = {
  defaultPreset: 'workspace-write',
  defaultOptions: [
    { value: 'workspace-write', name: 'ワークスペース書込', description: 'ワークスペースのファイルを読み書きできます。' },
    { value: 'danger-full-access', name: 'フル アクセス', description: 'ワークスペースの外も含め、すべての操作を許可します。' },
  ],
  options: [
    { value: 'workspace-write', name: 'ワークスペース書込', description: 'ワークスペースのファイルを読み書きできます。' },
    { value: 'danger-full-access', name: 'フル アクセス', description: 'ワークスペースの外も含め、すべての操作を許可します。' },
  ],
}
export const mockModelCatalog: ModelCatalog = {
  default: { provider: 'deepseek', model: 'deepseek-v4', reasoningEffort: 'high' },
  routableProviders: ['deepseek', 'ollama'],
  groups: [
    { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-v4', name: 'DeepSeek V4', reasoning: { efforts: [{ id: 'off', name: 'オフ（考えない）' }, { id: 'low', name: '低' }, { id: 'high', name: '高' }, { id: 'max', name: '最大' }], defaultEffort: 'high' } }] },
    { id: 'ollama', name: 'ローカル', models: [{ id: 'local', name: 'ローカル（ollama）', description: 'この端末のモデルを使います。' }] },
  ],
  failures: [],
}
const files: readonly FileReference[] = [
  { path: 'docs', kind: 'directory' },
  { path: 'docs/handoff.md', kind: 'file' },
  { path: 'docs/ui-spec.md', kind: 'file' },
  { path: 'README.md', kind: 'file' },
]

export function extendMock(kit: MockKit): void {
  ;(globalThis as typeof globalThis & { __m3eObserveModelSelection?: (read: (id: string) => unknown) => void })
    .__m3eObserveModelSelection?.(id => structuredClone(kit.getProjection(id, 'modelSelection')))
  let savedDefault = structuredClone(mockModelCatalog.default)
  const defaultSelection = async () => {
    const settings = kit.remoteOf<SettingsMockRemote>('settings')
    const description = await settings?.describe()
    const value = description?.ok ? description.value.namespaces.find(row => row.ns === 'agent-default-model')?.value : undefined
    return value ? value as unknown as ModelSelection : savedDefault
  }
  const saveDefault = async (value: ModelSelection) => {
    const settings = kit.remoteOf<SettingsMockRemote>('settings')
    if (!settings) { savedDefault = structuredClone(value); return }
    const description = await settings.describe()
    const row = description.ok ? description.value.namespaces.find(row => row.ns === 'agent-default-model') : undefined
    if (!row) return
    await settings.mutate(row.ns, [
      { op: 'set', path: ['provider'], value: value.provider }, { op: 'set', path: ['model'], value: value.model },
      value.reasoningEffort === undefined ? { op: 'unset', path: ['reasoningEffort'] } : { op: 'set', path: ['reasoningEffort'], value: value.reasoningEffort },
    ], row.revision)
  }
  kit.addRemote('permissionPresets', {
    async catalog() { return success(structuredClone(mockPermissionCatalog)) },
  })
  const known = new Set<string>()
  const initialize = (sessionId: string, initial: Readonly<Record<string, unknown>> = {}) => {
    known.add(sessionId)
    const selection = (initial.modelSelection ?? { lastUsed: null, next: null }) as ModelSelectionProjection
    kit.setProjection(sessionId, 'permissions', initial.permissions ?? structuredClone(mockPermissions))
    kit.setProjection(sessionId, 'plan', initial.plan ?? { active: false, pending: false })
    kit.setProjection(sessionId, 'modelSelection', selection)
  }
  const existing: SessionSummary[] = []
  kit.updateList(state => { existing.push(...Object.values(state.byId)) })
  // Projection writes also update the list; perform them after its snapshot callback.
  for (const summary of existing) initialize(summary.id, summary.projectionValues)

  // The foundation creates new sessions through this public method too.
  // Preserve a later feature's explicit projections when initializing its fixtures.
  const addSession = kit.addSession.bind(kit)
  kit.addSession = (summary, records) => {
    addSession(summary, records)
    initialize(summary.id, summary.projectionValues)
  }
  const removeSession = kit.removeSession.bind(kit)
  kit.removeSession = (sessionId) => {
    known.delete(sessionId)
    removeSession(sessionId)
  }

  const pending = new Map<string, ModelSelection>()
  kit.onRecord((sessionId, event) => {
    const current = kit.getProjection<ModelSelectionProjection>(sessionId, 'modelSelection')
    if (event.type === 'model/selection') {
      const next = event.data as unknown as ModelSelection
      pending.set(sessionId, next)
      kit.setProjection(sessionId, 'modelSelection', { lastUsed: current?.lastUsed ?? null, next })
    } else if (event.type === 'request/header') {
      const config = (event.data as unknown as { header: { config: ModelSelection } }).header.config
      const lastUsed = { provider: config.provider, model: config.model, ...(config.reasoningEffort === undefined ? {} : { reasoningEffort: config.reasoningEffort }) }
      const next = pending.get(sessionId)
      if (next?.provider === lastUsed.provider && next.model === lastUsed.model && next.reasoningEffort === lastUsed.reasoningEffort) pending.delete(sessionId)
      kit.setProjection(sessionId, 'modelSelection', { lastUsed, next: pending.get(sessionId) ?? lastUsed })
    }
  })
  const streamAssistant = kit.streamAssistant.bind(kit)
  kit.streamAssistant = (sessionId, text, options) => {
    const current = kit.getProjection<ModelSelectionProjection>(sessionId, 'modelSelection')
    const start = (used: ModelSelection) => streamAssistant(sessionId, text, { ...options, model: structuredClone(used) })
    return current?.next ? start(current.next) : kit.remoteOf('settings') ? defaultSelection().then(start) : start(savedDefault)
  }

  kit.addRemote('commands', {
    async list(sessionId: string) {
      return known.has(sessionId) ? success(structuredClone(mockCommands)) : failure('session/not-found', '会話が見つかりません。', { sessionId })
    },
  })
  kit.addRemote('fileReferences', {
    async list(sessionId: string, query: string, signal?: AbortSignal) {
      if (signal?.aborted) return failure('gateway/cancelled', '候補の検索を取り消しました。')
      if (!known.has(sessionId)) return failure('session/not-found', '会話が見つかりません。', { sessionId })
      return success(structuredClone(files.filter((file) => file.path.toLocaleLowerCase().startsWith(query.toLocaleLowerCase()))))
    },
  })
  kit.addRemote('session', {
    async modelCatalog() { return success(structuredClone({ ...mockModelCatalog, default: await defaultSelection() })) },
    async selectModel(input: ModelSelection & { sessionId: string }) {
      const testWindow = globalThis as typeof globalThis & {
        __m3eTestSelectModelDelay?: number
        __m3eTestSelectModelFailure?: boolean
      }
      const delay = Math.min(2000, Math.max(0, testWindow.__m3eTestSelectModelDelay ?? 0))
      if (delay) await new Promise(resolve => setTimeout(resolve, delay))
      const unavailable = () => failure('session/model-unavailable', 'このモデルや考える深さは選べません。', { provider: input.provider, model: input.model })
      if (testWindow.__m3eTestSelectModelFailure) return unavailable()
      if (!known.has(input.sessionId)) return failure('session/not-found', '会話が見つかりません。', { sessionId: input.sessionId })
      const model = mockModelCatalog.groups.find((group) => group.id === input.provider)?.models.find((model) => model.id === input.model)
      if (!model || (input.reasoningEffort !== undefined && !model.reasoning?.efforts.some((effort) => effort.id === input.reasoningEffort))) {
        return unavailable()
      }
      const effort = input.reasoningEffort ?? model.reasoning?.defaultEffort
      const value: ModelSelection = { provider: input.provider, model: input.model, ...(effort === undefined ? {} : { reasoningEffort: effort }) }
      kit.appendEvent(input.sessionId, 'model/selection', value)
      // Model installation does not await default persistence in the real Host.
      void Promise.resolve().then(() => saveDefault(value))
      return success({ selected: value })
    },
  })
}
