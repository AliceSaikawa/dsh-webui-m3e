import type { DshRemote, RemoteResult } from '../../dsh/services.ts'
import { RemoteCallError } from '../../dsh/remote-result.ts'

/** The settings namespace that stores the new-conversation default. */
export const AGENT_PRESET_NS = 'agent-preset-registry'
/** The settings namespace of the Coding Tools preference (`enabled`, true unless set to false). */
export const CODING_TOOLS_NS = 'ui-settings'

export interface AgentPresetRow {
  readonly id: string
  readonly isDefault: boolean
  readonly name?: string
  readonly description?: string
  /** The Host could not load this declaration; the row is listed but cannot be selected. */
  readonly broken?: string
}
export interface AgentPresetDocument {
  readonly id: string
  readonly name?: string
  readonly description?: string
  readonly content: string
}
export interface PresetCopy {
  readonly standardName: string
  readonly standardDescription: string
  readonly ptcName: string
  readonly ptcDescription: string
  readonly minimalName: string
  readonly minimalDescription: string
  readonly cordisName: string
  readonly cordisDescription: string
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const text = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined

/** Drop malformed or duplicate roster rows instead of trusting a Host payload. */
export function rosterOf(value: unknown): readonly AgentPresetRow[] {
  const row = record(value)
  if (!row || !Array.isArray(row.presets)) return []
  const seen = new Set<string>()
  return row.presets.flatMap(item => {
    const preset = record(item)
    const id = text(preset?.id)
    if (!preset || !id || seen.has(id)) return []
    seen.add(id)
    const name = text(preset.name), description = text(preset.description), broken = text(preset.broken)
    return [{
      id, isDefault: preset.isDefault === true,
      ...(name === undefined ? {} : { name }),
      ...(description === undefined ? {} : { description }),
      ...(broken === undefined ? {} : { broken }),
    }]
  })
}

export function documentOf(value: unknown, id: string): AgentPresetDocument | undefined {
  const row = record(value)
  if (!row || typeof row.content !== 'string') return undefined
  const name = text(row.name), description = text(row.description)
  return { id, content: row.content, ...(name === undefined ? {} : { name }), ...(description === undefined ? {} : { description }) }
}

const BUILT_IN = {
  standard: { name: 'standardName', description: 'standardDescription' },
  ptc: { name: 'ptcName', description: 'ptcDescription' },
  minimal: { name: 'minimalName', description: 'minimalDescription' },
  cordis: { name: 'cordisName', description: 'cordisDescription' },
} as const

/**
 * A shipped preset publishes no name, so its copy comes from the dictionaries.
 * A built-in id that names itself is a custom declaration and owns its copy.
 */
export function isBuiltInPreset(row: Pick<AgentPresetRow, 'id' | 'name'>): boolean {
  return row.name === undefined && Object.hasOwn(BUILT_IN, row.id)
}
export function presetDisplayText(row: AgentPresetRow, copy: PresetCopy): { name: string; description?: string } {
  const keys = isBuiltInPreset(row) ? BUILT_IN[row.id as keyof typeof BUILT_IN] : undefined
  if (keys) return { name: copy[keys.name], description: copy[keys.description] }
  return { name: row.name ?? row.id, ...(row.description === undefined ? {} : { description: row.description }) }
}
export function groupPresets(rows: readonly AgentPresetRow[]): { builtIn: AgentPresetRow[]; custom: AgentPresetRow[] } {
  const builtIn: AgentPresetRow[] = [], custom: AgentPresetRow[] = []
  for (const row of rows) (isBuiltInPreset(row) ? builtIn : custom).push(row)
  return { builtIn, custom }
}

/** Coding Tools are off only when the Host reports `enabled: false`; a missing or unreadable value keeps every mode. */
export function codingToolsDisabled(namespaces: readonly { readonly ns: string; readonly value?: unknown }[]): boolean {
  const row = namespaces.find(item => item.ns === CODING_TOOLS_NS)
  return record(row?.value)?.enabled === false
}

/** The shipped PTC and Minimal modes need Coding Tools; a named custom override keeps its own behavior. */
export function requiresCodingTools(row: Pick<AgentPresetRow, 'id' | 'name'> | undefined): boolean {
  return row !== undefined && isBuiltInPreset(row) && (row.id === 'ptc' || row.id === 'minimal')
}

/** Modes shown in the settings list: with Coding Tools off, PTC and Minimal are hidden. */
export function visiblePresets(rows: readonly AgentPresetRow[], codingToolsOff: boolean): readonly AgentPresetRow[] {
  return codingToolsOff ? rows.filter(row => !requiresCodingTools(row)) : rows
}

/**
 * What to do about the new-conversation default once Coding Tools are off:
 * `none` when it is still usable, `set-standard` to save `standard`, and
 * `standard-unavailable` when `standard` is missing or broken (nothing is saved).
 */
export type CodingToolsReset = 'none' | 'set-standard' | 'standard-unavailable'
export function codingToolsReset(rows: readonly AgentPresetRow[], codingToolsOff: boolean): CodingToolsReset {
  if (!codingToolsOff || !requiresCodingTools(rows.find(row => row.isDefault))) return 'none'
  return rows.some(row => row.id === 'standard' && row.broken === undefined) ? 'set-standard' : 'standard-unavailable'
}

interface AgentPresetsWire {
  list?(): Promise<RemoteResult<unknown>>
  read?(id: string): Promise<RemoteResult<unknown>>
}

/**
 * The optional `agentPresets` namespace. A Host without it has no roster, so
 * `list()` returns undefined instead of failing the settings screen.
 */
export function agentPresetsApi(remote: DshRemote) {
  const wire = (remote as { agentPresets?: AgentPresetsWire }).agentPresets
  const available = typeof wire?.list === 'function'
  return {
    available,
    async list(): Promise<readonly AgentPresetRow[] | undefined> {
      if (!wire || typeof wire.list !== 'function') return undefined
      const result = await wire.list()
      if (!result.ok) {
        if (result.error.code === 'gateway/invocation-unavailable') return undefined
        throw new RemoteCallError(result.error)
      }
      return rosterOf(result.value)
    },
    async read(id: string): Promise<AgentPresetDocument> {
      if (!wire || typeof wire.read !== 'function') throw new Error('agent presets are unavailable')
      const result = await wire.read(id)
      if (!result.ok) throw new RemoteCallError(result.error)
      const document = documentOf(result.value, id)
      if (!document) throw new Error('invalid agent preset document')
      return document
    },
  }
}
export type AgentPresetsApi = ReturnType<typeof agentPresetsApi>
