import { findSettingField } from './field-access.ts'
import type { SettingField, SettingValue, SettingsNamespace, generalNamespaces } from './schema.ts'
import type { GeneralTexts } from './messages.ts'

/**
 * How a dedicated row shows a field. The value still travels through the same
 * draft, queue and revision handling as a generic form field (`FieldEditor`);
 * only what the person reads changes.
 */
export interface FieldDisplay {
  /** The control to draw; the language row edits a free string through a list of choices. */
  kind: 'switch' | 'select'
  label: string
  description: string
  /** Replaces the schema's choices, in this order. Choosing a `null` choice removes the stored value. */
  choices?: readonly { label: string; value: string | null }[]
  /** The value the stock screen shows for a stored one (a default, or a legacy value). */
  effective?(stored: SettingValue | undefined): SettingValue | undefined
}

export type GeneralRowId = 'codingView'

/** One preference of the stock Settings → General, stored where the stock screen stores it. */
interface GeneralRow {
  readonly id: GeneralRowId
  readonly ns: typeof generalNamespaces[number]
  /** Top-level key in the namespace's document. */
  readonly key: string
  readonly kind: 'switch' | 'select'
  /** The kind the Host's schema must give this key; any other means the Host changed shape, so the row is not shown. */
  readonly schemaKind: SettingField['kind']
  /** Stored values the row offers, in order. Every one must be a choice of the Host's schema. */
  readonly choices?: readonly string[]
  /** What the stock screen uses while nothing is stored. */
  readonly fallback?: SettingValue
  /** Saved values the stock screen reads as another value without offering them. */
  readonly legacy?: Readonly<Record<string, string>>
}

export const generalRows: readonly GeneralRow[] = [
  // dsh-client-ui-settings DeveloperToolsPreference: `enabled`, true unless saved otherwise.
  { id: 'codingView', ns: 'ui-settings', key: 'enabled', kind: 'switch', schemaKind: 'switch', fallback: true },
]

/** The value the stock screen shows for a stored one. */
export function effectiveValue(row: Pick<GeneralRow, 'fallback' | 'legacy'>, stored: SettingValue | undefined): SettingValue | undefined {
  if (stored === undefined) return row.fallback
  return typeof stored === 'string' ? row.legacy?.[stored] ?? stored : stored
}

function rowText(id: GeneralRowId, text: GeneralTexts): { title: string; description: string; choiceLabels?: Readonly<Record<string, string>> } {
  switch (id) {
    case 'codingView': return { title: text.codingViewTitle, description: text.codingViewDescription }
  }
}

export interface GeneralEntry {
  readonly id: GeneralRowId
  readonly namespace: SettingsNamespace
  /** The Host's field for this key, as the generic form reads it. */
  readonly field: SettingField
  readonly display: FieldDisplay
}

/**
 * The rows to draw for this Host. A row whose namespace is missing, whose key
 * the schema does not describe with the expected control, or whose choices the
 * schema would not accept is left out: nothing is guessed.
 */
export function generalEntries(namespaces: readonly SettingsNamespace[], text: GeneralTexts): GeneralEntry[] {
  return generalRows.flatMap((row): GeneralEntry[] => {
    const namespace = namespaces.find(item => item.ns === row.ns)
    const field = namespace && findSettingField(namespace, [row.key])
    if (!namespace || !field || field.omitted || field.kind !== row.schemaKind) return []
    const offered = field.options?.map(option => option.value)
    if (row.choices && !row.choices.every(choice => offered?.includes(choice))) return []
    const { title, description, choiceLabels } = rowText(row.id, text)
    const choices = row.choices?.map(value => ({ label: choiceLabels?.[value] ?? value, value }))
    return [{
      id: row.id, namespace, field,
      display: { kind: row.kind, label: title, description, ...(choices ? { choices } : {}), effective: stored => effectiveValue(row, stored) },
    }]
  })
}
