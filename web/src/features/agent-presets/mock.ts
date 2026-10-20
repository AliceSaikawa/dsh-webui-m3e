import type { MockKit } from '../../dsh/mock/kit.ts'
import type { RemoteResult } from '../../dsh/services.ts'
import type { AgentPresetDocument, AgentPresetRoster, AgentPresetRow } from './api.ts'

/** Fake roster for the mode page. Japanese fixture text is host data, not UI copy. */

const success = <T>(value: T): RemoteResult<T> => ({ ok: true, value: structuredClone(value) })
const failure = (code: string, message: string, details: Readonly<Record<string, unknown>> = {}): RemoteResult<never> =>
  ({ ok: false, error: { code, message, details } })

type Fixture = Omit<AgentPresetRow, 'isDefault'>

const fixtures: readonly Fixture[] = [
  { id: 'standard' },
  { id: 'ptc' },
  { id: 'minimal' },
  { id: 'cordis' },
  { id: 'review', name: '見直し', description: '差分を読んでから直します。' },
  { id: 'legacy', name: '旧モード', broken: 'プラグイン @example/missing を読み込めません' },
]

const documents: Readonly<Record<string, string>> = {
  standard: [
    '- name: "@deepseek-ai/dsh-tool-shell"',
    '  config:',
    '    enabled: !!js true',
  ].join('\n'),
  ptc: '- name: "@deepseek-ai/dsh-tool-shell"\n- name: "@deepseek-ai/dsh-tool-ptc"\n',
  minimal: '- name: "@deepseek-ai/dsh-tool-shell"\n',
  cordis: '- name: "@deepseek-ai/dsh-agent-preset"\n  config:\n    id: cordis\n',
  review: '- name: "@example/dsh-preset-review"\n  config:\n    note: "差分"\n',
  legacy: '- name: "@example/missing"\n  config:\n    when: !!js "missing"\n',
}

function chosenDefault(rows: readonly Fixture[], selected: unknown): string | undefined {
  if (typeof selected === 'string' && rows.some(row => row.id === selected)) return selected
  if (rows.some(row => row.id === 'standard')) return 'standard'
  return rows[0]?.id
}

export function extendMock(kit: MockKit): void {
  let listFails = false
  let readFails = false
  let rows: readonly Fixture[] = fixtures
  if (!kit.isScenario('modes-unavailable')) {
    kit.addRemote('agentPresets', {
    async list(): Promise<RemoteResult<AgentPresetRoster>> {
      if (listFails) return failure('gateway/internal', 'モードの一覧を取得できませんでした。')
      const selected = kit.getSettingsValue<{ selectedDefault?: unknown }>('agent-preset-registry')?.selectedDefault
      const chosen = chosenDefault(rows, selected)
      return success<AgentPresetRoster>({
        presets: rows.map(row => ({ ...row, isDefault: row.id === chosen })),
      })
    },
    async read(id: string): Promise<RemoteResult<AgentPresetDocument>> {
      if (readFails) return failure('gateway/internal', '構成を読み込めませんでした。')
      const row = rows.find(item => item.id === id)
      if (!row) return failure('agent-preset/not-found', 'そのモードはありません。', { agentPreset: id, available: rows.map(item => item.id) })
      const content = documents[id]
      if (content === undefined) return failure('agent-preset/not-found', 'そのモードはありません。', { agentPreset: id, available: rows.map(item => item.id) })
      return success<AgentPresetDocument>({
        agentPreset: id,
        content,
        ...(row.name !== undefined ? { name: row.name } : {}),
        ...(row.description !== undefined ? { description: row.description } : {}),
      })
    },
  })
  }
  kit.scenario('modes-unavailable', () => {})
  kit.scenario('modes-error', () => { listFails = true })
  kit.scenario('modes-read-error', () => { readFails = true })
  kit.scenario('modes-empty', () => { rows = [] })
}
