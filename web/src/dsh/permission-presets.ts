/**
 * Presentation for DSH permission presets. The Host names the built-in presets
 * after their machine key (or the stock English label), so the shipped client
 * replaces those names and descriptions with product copy. These are the same
 * substitutions for this UI. A host-supplied name outside the built-ins is kept.
 */

import { messagesOf, type Translation } from '../i18n/catalog.ts'
import { currentLocale } from '../i18n/current.ts'
import { permissionPresetMessages } from './messages.ts'

export type PermissionPresetTexts = Translation<typeof permissionPresetMessages.ja>

const textOf = (): PermissionPresetTexts => messagesOf(permissionPresetMessages, currentLocale())

const BUILTIN_NAMES = {
  'read-only': 'readOnly',
  'workspace-write': 'workspaceWrite',
  'danger-full-access': 'dangerFullAccess',
} as const satisfies Record<string, keyof PermissionPresetTexts>
/** Stock English labels the Host may use instead of the machine key. */
const STOCK_NAMES: Record<string, readonly string[]> = {
  'read-only': ['Read Only'],
  'workspace-write': ['Workspace Write'],
  'danger-full-access': ['Full access'],
}
/**
 * Stock English descriptions from the plugin's default config, for a Host that
 * passes that config through unchanged. dsh-base's layout has no descriptions,
 * so these never match there. It ships none for read-only.
 */
const STOCK_DESCRIPTIONS: Record<string, string> = {
  'workspace-write': 'Write inside the workspace and permitted temporary directories; wider retries require approval.',
  'danger-full-access': 'Full file access without approval prompts.',
}
const BUILTIN_DESCRIPTIONS = {
  'workspace-write': 'workspaceWriteDescription',
  'danger-full-access': 'dangerFullAccessDescription',
} as const satisfies Record<string, keyof PermissionPresetTexts>

function isStockName(value: string, hostName: string): boolean {
  if (hostName === '' || hostName === value) return true
  return own(STOCK_NAMES, value)?.some(stock => stock.toLowerCase() === hostName.toLowerCase()) ?? false
}

const own = <T extends object>(table: T, key: string): T[keyof T] | undefined => Object.hasOwn(table, key) ? table[key as keyof T] : undefined

/** Built-in product label, or the Host's own name when it customized the preset. `text` is for tests. */
export function presetDisplayName(value: string, hostName: string, text: PermissionPresetTexts = textOf()): string {
  if (value === 'auto') return text.autoReview
  if (value === 'custom') return text.custom
  const key = own(BUILTIN_NAMES, value)
  if (key !== undefined && isStockName(value, hostName)) return text[key]
  return hostName || value
}

/** Built-in description when the Host sent exactly the stock English one; any other Host copy is kept as-is. */
export function presetDescription(value: string, hostDescription: string | undefined, text: PermissionPresetTexts = textOf()): string | undefined {
  if (value === 'auto') return text.autoReviewDescription
  const key = own(BUILTIN_DESCRIPTIONS, value)
  if (key !== undefined && hostDescription?.trim() === STOCK_DESCRIPTIONS[value]) return text[key]
  return hostDescription
}
