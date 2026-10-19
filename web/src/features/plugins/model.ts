import type { Locale } from '../../i18n/locale.ts'
import { compareText } from '../../i18n/format.ts'
import type { BundleInfo, FiberPhase, LocalizedText, PluginBundleErrorCode, PluginEntry, PluginInventorySnapshot, PluginLocalizedMeta } from './api.ts'
import type { PluginTexts } from './messages.ts'

/** Pure presentation rules for the read-only plugin list (unit-tested in tests/96-plugins.test.ts). */

/** A localized value: the asked-for language, then `ja`, then `en`. A string is used as is. */
export function localizedText(text: LocalizedText | undefined, locale: string): string | undefined {
  if (text === undefined) return undefined
  if (typeof text === 'string') return text
  return text[locale] ?? text.ja ?? text.en
}

/** Strip an `@scope/` and a `dsh-` / `dsh-plugin-` prefix from a module name. */
export function shortModuleName(moduleName: string): string {
  const slash = moduleName.lastIndexOf('/')
  const name = slash >= 0 ? moduleName.slice(slash + 1) : moduleName
  return name.replace(/^dsh-plugin-/, '').replace(/^dsh-/, '')
}

export function pluginTitle(entry: { readonly moduleName: string; readonly meta?: PluginLocalizedMeta }, locale: string): string {
  const title = localizedText(entry.meta?.title, locale)
  return title !== undefined && title !== '' ? title : shortModuleName(entry.moduleName)
}

/** The plugin's state as one short label; disabled and failed are distinct. */
export function phaseLabel(phase: FiberPhase, enabled: boolean, text: PluginTexts): string {
  if (!enabled) return text.phaseDisabled
  if (phase === 'active') return text.phaseActive
  if (phase === 'loading') return text.phaseLoading
  if (phase === 'pending') return text.phasePending
  if (phase === 'unloading') return text.phaseUnloading
  if (phase === 'failed') return text.phaseFailed
  return text.phaseNotStarted
}

type StringKey<T> = { [K in keyof T]: T[K] extends string ? K : never }[keyof T]
const BUNDLE_ERROR_KEYS: Record<PluginBundleErrorCode, StringKey<PluginTexts>> = {
  'management-required': 'errorManagementRequired',
  'unaddressable': 'errorUnaddressable',
  'unknown-plugin': 'errorUnknownPlugin',
  'invalid-spec': 'errorInvalidSpec',
  'ambiguous-install': 'errorAmbiguousInstall',
  'not-bundle': 'errorNotBundle',
  'not-removable': 'errorNotRemovable',
  'stop-profile': 'errorStopProfile',
  'bundle-in-use': 'errorBundleInUse',
  'stale-approval': 'errorStaleApproval',
  'incompatible-version': 'errorIncompatibleVersion',
  'operation-error': 'errorOperationError',
}

export function bundleErrorLabel(code: PluginBundleErrorCode, text: PluginTexts): string {
  return text[BUNDLE_ERROR_KEYS[code]]
}

export interface BundleGroup {
  readonly bundle: BundleInfo
  /** Inventory entries matched by the bundle's rows, in row order. */
  readonly entries: readonly PluginEntry[]
}
export interface PluginGroups {
  readonly failed: readonly PluginEntry[]
  readonly active: readonly PluginEntry[]
  readonly disabled: readonly PluginEntry[]
  readonly other: readonly PluginEntry[]
  readonly bundles: readonly BundleGroup[]
}

/**
 * Group the snapshot for display. Failed comes first, then disabled, then the
 * running plugins; everything else (pending, loading, unloading, never
 * started) goes to `other`. Each group is sorted by its shown title.
 */
export function groupPlugins(snapshot: PluginInventorySnapshot | undefined, bundles: readonly BundleInfo[] | undefined, locale: Locale = 'ja'): PluginGroups {
  const entries = snapshot?.entries ?? []
  const titleOf = (entry: PluginEntry) => pluginTitle(entry, locale)
  const ordered = [...entries].sort((a, b) => compareText(locale, titleOf(a), titleOf(b)))
  const failed: PluginEntry[] = []
  const active: PluginEntry[] = []
  const disabled: PluginEntry[] = []
  const other: PluginEntry[] = []
  for (const entry of ordered) {
    if (entry.fiberPhase === 'failed') failed.push(entry)
    else if (!entry.enabled) disabled.push(entry)
    else if (entry.fiberPhase === 'active') active.push(entry)
    else other.push(entry)
  }
  const byEntryId = new Map(entries.map(entry => [entry.entryId, entry]))
  const groups = (bundles ?? []).map(bundle => ({
    bundle,
    entries: bundle.rows.flatMap(row => {
      const entry = row.entryId === undefined ? undefined : byEntryId.get(row.entryId)
      return entry ? [entry] : []
    }),
  }))
  return { failed, active, disabled, other, bundles: groups }
}
