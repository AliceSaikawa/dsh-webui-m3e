import type { DshRemote, RemoteResult } from '../../dsh/services.ts'
import { unwrapRemoteResult } from '../../dsh/remote-result.ts'

/**
 * Agent-preset roster and the new-conversation default.
 *
 * Shapes are the DSH 0.2.1-rc.2 wire (`agentPresets.list` / `read`, and
 * `settings.update` on `agent-preset-registry.selectedDefault`). The namespace
 * is optional, so it stays off the boot contract and every payload is checked
 * before use.
 */

export const AGENT_PRESET_SETTINGS_NS = 'agent-preset-registry'

export interface AgentPresetRow {
  readonly id: string
  readonly isDefault: boolean
  readonly name?: string
  readonly description?: string
  /** Why this preset cannot compose a session. Absent when it can. */
  readonly broken?: string
}

export interface AgentPresetRoster {
  readonly presets: readonly AgentPresetRow[]
}

export interface AgentPresetDocument {
  readonly agentPreset: string
  readonly content: string
  readonly name?: string
  readonly description?: string
}

/** What this page needs from `settings.describe()`, not the whole schema. */
export interface PresetSettingsFacts {
  readonly writable: boolean
  readonly revision?: number
  /** False only when General settings has explicitly turned Coding Tools off. */
  readonly codingToolsEnabled: boolean
}

interface PresetRemote {
  readonly agentPresets?: {
    list(): Promise<RemoteResult<unknown>>
    read(agentPreset: string): Promise<RemoteResult<unknown>>
  }
  readonly settings?: {
    describe(): Promise<RemoteResult<unknown>>
    update(ns: string, patch: { selectedDefault: string }, revision: number): Promise<RemoteResult<unknown>>
  }
}

type RecordValue = Record<string, unknown>
const record = (value: unknown): RecordValue | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as RecordValue : undefined
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value !== ''
const text = (value: unknown): string | undefined => nonEmpty(value) ? value : undefined

function rowOf(value: unknown): AgentPresetRow | undefined {
  const row = record(value)
  if (!row || !nonEmpty(row.id) || typeof row.isDefault !== 'boolean') return undefined
  const name = text(row.name)
  const description = text(row.description)
  const broken = text(row.broken)
  return {
    id: row.id,
    isDefault: row.isDefault,
    ...(name !== undefined ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(broken !== undefined ? { broken } : {}),
  }
}

/** Drop malformed rows. A payload that is not a roster is an empty roster. */
export function rosterOf(value: unknown): AgentPresetRoster {
  const row = record(value)
  const presets = Array.isArray(row?.presets) ? row.presets.flatMap(item => rowOf(item) ?? []) : []
  return { presets }
}

/** A composition the viewer can show. Undefined when the payload is not one. */
export function documentOf(value: unknown): AgentPresetDocument | undefined {
  const row = record(value)
  if (!row || !nonEmpty(row.agentPreset) || typeof row.content !== 'string') return undefined
  const name = text(row.name)
  const description = text(row.description)
  return {
    agentPreset: row.agentPreset,
    content: row.content,
    ...(name !== undefined ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
  }
}

/** Facts for the default write. Undefined when describe() did not return a description. */
export function presetSettingsFacts(value: unknown): PresetSettingsFacts | undefined {
  const row = record(value)
  if (!row || typeof row.writable !== 'boolean' || !Array.isArray(row.namespaces)) return undefined
  const namespaces: RecordValue[] = []
  for (const item of row.namespaces) {
    const parsed = record(item)
    if (parsed) namespaces.push(parsed)
  }
  const registry = namespaces.find(item => item.ns === AGENT_PRESET_SETTINGS_NS)
  const tools = namespaces.find(item => item.ns === 'ui-settings')
  const enabled = record(tools?.value)?.enabled
  return {
    writable: row.writable,
    ...(typeof registry?.revision === 'number' ? { revision: registry.revision } : {}),
    codingToolsEnabled: enabled !== false,
  }
}

export function agentPresetsApi(remote: DshRemote) {
  const wire = remote as PresetRemote
  return {
    async list(): Promise<AgentPresetRoster | undefined> {
      if (typeof wire.agentPresets?.list !== 'function') return undefined
      return rosterOf(unwrapRemoteResult(await wire.agentPresets.list()))
    },
    async read(id: string): Promise<AgentPresetDocument> {
      if (typeof wire.agentPresets?.read !== 'function') throw new Error('agentPresets.read is missing')
      const document = documentOf(unwrapRemoteResult(await wire.agentPresets.read(id)))
      if (document === undefined || document.agentPreset !== id) throw new Error('agentPresets.read returned an unusable document')
      return document
    },
    async describeSettings(): Promise<PresetSettingsFacts | undefined> {
      if (typeof wire.settings?.describe !== 'function') return undefined
      return presetSettingsFacts(unwrapRemoteResult(await wire.settings.describe()))
    },
    async setDefault(id: string, revision: number): Promise<void> {
      if (typeof wire.settings?.update !== 'function') throw new Error('settings.update is missing')
      unwrapRemoteResult(await wire.settings.update(AGENT_PRESET_SETTINGS_NS, { selectedDefault: id }, revision))
    },
  }
}
