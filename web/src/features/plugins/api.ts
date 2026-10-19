import type { DshRemote, RemoteResult } from '../../dsh/services.ts'
import { unwrapRemoteResult } from '../../dsh/remote-result.ts'

/**
 * Read-only view of the two optional DSH 0.2.0-rc.2 plugin namespaces,
 * restated from the installed client plugins. Both namespaces are optional on
 * a Host, so none of these are part of the boot contract
 * (web/src/dsh/contract.ts) and every shape is checked before it is used.
 */

export type LocalizedText = string | { readonly en: string; readonly [locale: string]: string }
export interface PluginLocalizedMeta {
  readonly title?: LocalizedText
  readonly description?: LocalizedText
  /** base64 data URL */
  readonly icon?: string
  /** metadata diagnostic */
  readonly error?: string
}
export type FiberPhase = 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null
export interface PluginEntry {
  readonly entryId: string
  readonly moduleName: string
  readonly meta?: PluginLocalizedMeta
  readonly enabled: boolean
  readonly fiberPhase: FiberPhase
}
export interface PluginInventorySnapshot {
  readonly managementAvailable?: boolean
  readonly entries: readonly PluginEntry[]
  readonly agentPresets?: readonly unknown[]
}
export type PluginBundleErrorCode =
  | 'management-required' | 'unaddressable' | 'unknown-plugin' | 'invalid-spec'
  | 'ambiguous-install' | 'not-bundle' | 'not-removable' | 'stop-profile'
  | 'bundle-in-use' | 'stale-approval' | 'incompatible-version' | 'operation-error'
export interface IncompatiblePackage {
  readonly name: string
  readonly version: string
  readonly runtimeVersion: string
  readonly peers: Readonly<Record<string, string>>
}
export interface PluginBundleError {
  readonly code: PluginBundleErrorCode
  readonly diagnostic?: string
  readonly incompatible?: readonly IncompatiblePackage[]
}
export interface BundleRow {
  readonly rowId: string
  readonly moduleName: string
  readonly meta?: PluginLocalizedMeta
  readonly entryId?: string
}
export interface BundleInfo {
  readonly name: string
  readonly version?: string
  readonly meta?: PluginLocalizedMeta
  readonly description?: string
  readonly enabled: boolean
  readonly installed: boolean
  readonly optional: boolean
  readonly removable: boolean
  readonly readOnlyReason?: 'management-required' | 'unaddressable'
  readonly error?: PluginBundleError
  readonly rows: readonly BundleRow[]
  readonly overrides: readonly string[]
}

interface PluginsRemote {
  readonly pluginInventory?: { list(): Promise<RemoteResult<unknown>> }
  readonly pluginManager?: { listBundles(): Promise<RemoteResult<unknown>> }
}

type RecordValue = Record<string, unknown>
const record = (value: unknown): RecordValue | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as RecordValue : undefined
const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value !== ''

const PHASES: readonly FiberPhase[] = ['pending', 'loading', 'active', 'failed', 'unloading']
const ERROR_CODES: readonly PluginBundleErrorCode[] = [
  'management-required', 'unaddressable', 'unknown-plugin', 'invalid-spec',
  'ambiguous-install', 'not-bundle', 'not-removable', 'stop-profile',
  'bundle-in-use', 'stale-approval', 'incompatible-version', 'operation-error',
]

function localizedTextOf(value: unknown): LocalizedText | undefined {
  if (typeof value === 'string') return value
  const row = record(value)
  if (row === undefined || typeof row.en !== 'string') return undefined
  const text: Record<string, string> = { en: row.en }
  for (const [locale, message] of Object.entries(row)) if (typeof message === 'string') text[locale] = message
  return text as LocalizedText
}

function metaOf(value: unknown): PluginLocalizedMeta | undefined {
  const row = record(value)
  if (!row) return undefined
  const title = localizedTextOf(row.title)
  const description = localizedTextOf(row.description)
  const meta: { title?: LocalizedText; description?: LocalizedText; icon?: string; error?: string } = {}
  if (title !== undefined) meta.title = title
  if (description !== undefined) meta.description = description
  if (typeof row.icon === 'string') meta.icon = row.icon
  if (typeof row.error === 'string') meta.error = row.error
  return Object.keys(meta).length > 0 ? meta : undefined
}

function entryOf(value: unknown): PluginEntry | undefined {
  const row = record(value)
  if (!row || !nonEmptyString(row.entryId) || !nonEmptyString(row.moduleName)) return undefined
  if (typeof row.enabled !== 'boolean') return undefined
  const phase = typeof row.fiberPhase === 'string' && (PHASES as readonly string[]).includes(row.fiberPhase)
    ? row.fiberPhase as FiberPhase
    : null
  const meta = metaOf(row.meta)
  return { entryId: row.entryId, moduleName: row.moduleName, enabled: row.enabled, fiberPhase: phase, ...(meta ? { meta } : {}) }
}

/** A point-in-time snapshot; malformed entries are dropped rather than trusted. */
export function inventorySnapshotOf(value: unknown): PluginInventorySnapshot {
  const row = record(value)
  if (!row) return { entries: [] }
  const entries = Array.isArray(row.entries) ? row.entries.flatMap(entry => entryOf(entry) ?? []) : []
  return {
    ...(row.managementAvailable === true ? { managementAvailable: true } : {}),
    entries,
    ...(Array.isArray(row.agentPresets) ? { agentPresets: row.agentPresets } : {}),
  }
}

function incompatibleOf(value: unknown): IncompatiblePackage | undefined {
  const row = record(value)
  if (!row || !nonEmptyString(row.name) || typeof row.version !== 'string' || typeof row.runtimeVersion !== 'string') return undefined
  const peers: Record<string, string> = {}
  const peerRecord = record(row.peers)
  if (peerRecord) for (const [name, range] of Object.entries(peerRecord)) if (typeof range === 'string') peers[name] = range
  return { name: row.name, version: row.version, runtimeVersion: row.runtimeVersion, peers }
}

function bundleErrorOf(value: unknown): PluginBundleError | undefined {
  const row = record(value)
  if (!row || typeof row.code !== 'string' || !(ERROR_CODES as readonly string[]).includes(row.code)) return undefined
  const incompatible = Array.isArray(row.incompatible) ? row.incompatible.flatMap(item => incompatibleOf(item) ?? []) : []
  return {
    code: row.code as PluginBundleErrorCode,
    ...(typeof row.diagnostic === 'string' ? { diagnostic: row.diagnostic } : {}),
    ...(incompatible.length > 0 ? { incompatible } : {}),
  }
}

function bundleRowOf(value: unknown): BundleRow | undefined {
  const row = record(value)
  if (!row || !nonEmptyString(row.rowId) || !nonEmptyString(row.moduleName)) return undefined
  const meta = metaOf(row.meta)
  return { rowId: row.rowId, moduleName: row.moduleName, ...(meta ? { meta } : {}), ...(nonEmptyString(row.entryId) ? { entryId: row.entryId } : {}) }
}

function bundleOf(value: unknown): BundleInfo | undefined {
  const row = record(value)
  if (!row || !nonEmptyString(row.name)) return undefined
  const meta = metaOf(row.meta)
  const error = bundleErrorOf(row.error)
  const readOnlyReason = row.readOnlyReason === 'management-required' || row.readOnlyReason === 'unaddressable' ? row.readOnlyReason : undefined
  return {
    name: row.name,
    ...(typeof row.version === 'string' ? { version: row.version } : {}),
    ...(meta ? { meta } : {}),
    ...(typeof row.description === 'string' ? { description: row.description } : {}),
    enabled: row.enabled === true,
    installed: row.installed === true,
    optional: row.optional === true,
    removable: row.removable === true,
    ...(readOnlyReason ? { readOnlyReason } : {}),
    ...(error ? { error } : {}),
    rows: Array.isArray(row.rows) ? row.rows.flatMap(item => bundleRowOf(item) ?? []) : [],
    overrides: Array.isArray(row.overrides) ? row.overrides.filter(nonEmptyString) : [],
  }
}

export function bundleListOf(value: unknown): readonly BundleInfo[] {
  return Array.isArray(value) ? value.flatMap(item => bundleOf(item) ?? []) : []
}

/** Namespaces are read only when the Host exposes them; an absent one is undefined. */
export function pluginsApi(remote: DshRemote) {
  const wire = remote as PluginsRemote
  return {
    async inventory(): Promise<PluginInventorySnapshot | undefined> {
      if (typeof wire.pluginInventory?.list !== 'function') return undefined
      return inventorySnapshotOf(unwrapRemoteResult(await wire.pluginInventory.list()))
    },
    async bundles(): Promise<readonly BundleInfo[] | undefined> {
      if (typeof wire.pluginManager?.listBundles !== 'function') return undefined
      return bundleListOf(unwrapRemoteResult(await wire.pluginManager.listBundles()))
    },
  }
}
