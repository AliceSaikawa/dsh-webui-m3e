import type { MockKit } from '../../dsh/mock/kit.ts'
import { MOCK_IDS } from '../../dsh/mock/fixtures.ts'
import type { RemoteResult } from '../../dsh/services.ts'
import type { CommandDescriptor, FileReference, ModelCatalog, ModelSelection, ModelSelectionProjection, PermissionProjection } from './api.ts'

const success = <T>(value: T): RemoteResult<T> => ({ ok: true, value })
const failure = (code: string, message: string): RemoteResult<never> => ({ ok: false, error: { code, message, details: {} } })

export const mockCommands: readonly CommandDescriptor[] = [
  { name: 'plan', description: '計画モードに切り替えます。off で終了します。', input: { hint: '計画したいこと、または off' } },
  { name: 'permission', description: 'この会話の権限を切り替えます。', input: { hint: '権限のプリセット名' } },
  { name: 'model', description: 'この会話で使うモデルを選びます。' },
]
export const mockPermissions: PermissionProjection = {
  currentValue: 'workspace-write',
  options: [
    { value: 'workspace-write', name: 'ワークスペース書込', description: 'ワークスペースのファイルを読み書きできます。' },
    { value: 'danger-full-access', name: 'フル アクセス', description: 'ワークスペースの外も含め、すべての操作を許可します。' },
  ],
}
export const mockModelCatalog: ModelCatalog = {
  default: { provider: 'deepseek', model: 'deepseek-v4', reasoningEffort: 'medium' },
  routableProviders: ['deepseek', 'ollama'],
  groups: [
    { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-v4', name: 'DeepSeek V4', reasoning: { efforts: [{ id: 'low', name: '低' }, { id: 'medium', name: '中' }, { id: 'high', name: '高' }], defaultEffort: 'medium' } }] },
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
  const known = new Set<string>()
  const selected = new Map<string, ModelSelectionProjection>()
  const initialize = (sessionId: string, initial: Readonly<Record<string, unknown>> = {}) => {
    known.add(sessionId)
    const selection = (initial.modelSelection ?? { lastUsed: null, next: null }) as ModelSelectionProjection
    selected.set(sessionId, selection)
    kit.setProjection(sessionId, 'permissions', initial.permissions ?? structuredClone(mockPermissions))
    kit.setProjection(sessionId, 'plan', initial.plan ?? { active: false, pending: false })
    kit.setProjection(sessionId, 'modelSelection', selection)
  }
  for (const sessionId of Object.values(MOCK_IDS.sessions)) initialize(sessionId)

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
    selected.delete(sessionId)
    removeSession(sessionId)
  }

  kit.addRemote('commands', {
    async list(sessionId: string) {
      return known.has(sessionId) ? success(structuredClone(mockCommands)) : failure('session/not-found', '会話が見つかりません。')
    },
  })
  kit.addRemote('fileReferences', {
    async list(sessionId: string, query: string, signal: AbortSignal) {
      if (signal.aborted) return failure('rpc/aborted', '候補の検索を取り消しました。')
      if (!known.has(sessionId)) return failure('session/not-found', '会話が見つかりません。')
      return success(structuredClone(files.filter((file) => file.path.toLocaleLowerCase().startsWith(query.toLocaleLowerCase()))))
    },
  })
  kit.addRemote('session', {
    async modelCatalog() { return success(structuredClone(mockModelCatalog)) },
    async selectModel(input: ModelSelection & { sessionId: string }) {
      if (!known.has(input.sessionId)) return failure('session/not-found', '会話が見つかりません。')
      const model = mockModelCatalog.groups.find((group) => group.id === input.provider)?.models.find((model) => model.id === input.model)
      if (!model || (input.reasoningEffort !== undefined && !model.reasoning?.efforts.some((effort) => effort.id === input.reasoningEffort))) {
        return failure('session/model-unavailable', 'このモデルや考える深さは選べません。')
      }
      const value: ModelSelection = { provider: input.provider, model: input.model, ...(input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort }) }
      const projection: ModelSelectionProjection = { lastUsed: selected.get(input.sessionId)?.lastUsed ?? null, next: value }
      selected.set(input.sessionId, projection)
      kit.setProjection(input.sessionId, 'modelSelection', projection)
      return success({ selected: value })
    },
  })
}
