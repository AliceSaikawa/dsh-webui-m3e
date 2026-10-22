import { findSettingField } from './field-access.ts'
import { valueAt, type SettingField, type SettingValue, type SettingsNamespace, type generalNamespaces } from './schema.ts'
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

export type GeneralRowId = 'codingView' | 'transcriptView' | 'collapseTiming' | 'performanceUsage' | 'language'

/** One preference of the stock Settings → General, stored where the stock screen stores it. */
interface GeneralRow {
  readonly id: GeneralRowId
  readonly ns: typeof generalNamespaces[number]
  /** Top-level key in the namespace's document. */
  readonly key: string
  readonly kind: 'switch' | 'select'
  /** The kind the Host's schema must give this key; any other means the Host changed shape, so the row is not shown. */
  readonly schemaKind: SettingField['kind']
  /** Stored values the row offers, in order. For a `select` schema every one must be a choice of the Host's schema. */
  readonly choices?: readonly string[]
  /** Offer "nothing stored" first; choosing it removes the stored value. */
  readonly unsettable?: boolean
  /** The schema is a free string: a stored value outside `choices` (another client wrote it) is shown as it is. */
  readonly open?: boolean
  /** What the stock screen uses while nothing is stored. */
  readonly fallback?: SettingValue
  /** Saved values the stock screen reads as another value without offering them. */
  readonly legacy?: Readonly<Record<string, string>>
}

export const generalRows: readonly GeneralRow[] = [
  // dsh-client-ui-settings DeveloperToolsPreference: `enabled`, true unless saved otherwise.
  { id: 'codingView', ns: 'ui-settings', key: 'enabled', kind: 'switch', schemaKind: 'switch', fallback: true },
  // dsh-client-ui-chat (`ui-chat`): work details. The Host has no default for `transcriptView`; the stock
  // client uses `detailed` outside the desktop app and reads the saved `normal`/`expanded` as `detailed`.
  { id: 'transcriptView', ns: 'ui-chat', key: 'transcriptView', kind: 'select', schemaKind: 'select', fallback: 'detailed',
    choices: ['compact', 'standard', 'detailed', 'verbose'], legacy: { normal: 'detailed', expanded: 'detailed' } },
  { id: 'collapseTiming', ns: 'ui-chat', key: 'collapseTiming', kind: 'select', schemaKind: 'select', fallback: 'completion',
    choices: ['completion', 'next-input'] },
  { id: 'performanceUsage', ns: 'ui-chat', key: 'performanceUsage', kind: 'select', schemaKind: 'select', fallback: 'detailed',
    choices: ['compact', 'detailed'] },
  // dsh-client-locale (`locale`): `preference`, a free string of the form [A-Za-z]{2,8}(-…)*; the stock screen
  // offers its two built-in languages, `zh` and `en`, and no stored value means the browser's language. M3E also
  // offers `ja`: the stock screen does not register it and then follows the browser as if nothing were stored.
  { id: 'language', ns: 'locale', key: 'preference', kind: 'select', schemaKind: 'text', fallback: null,
    choices: ['ja', 'en', 'zh'], unsettable: true, open: true },
]

/** The value the stock screen shows for a stored one. */
export function effectiveValue(row: Pick<GeneralRow, 'fallback' | 'legacy' | 'schemaKind' | 'choices' | 'open'>, stored: SettingValue | undefined): SettingValue | undefined {
  // The draft of a text field with nothing stored is '' (see `inputValue` in store.ts).
  if (stored === undefined || (stored === '' && row.schemaKind === 'text')) return row.fallback
  if (typeof stored !== 'string') return stored
  return row.legacy?.[stored] ?? (row.open ? sameChoice(row, stored) : undefined) ?? stored
}

/** The stock client compares language tags in lower case (`localeKey`), so `EN` is the choice `en`. */
function sameChoice(row: Pick<GeneralRow, 'choices'>, stored: string): string | undefined {
  return row.choices?.find(choice => choice === stored.toLowerCase())
}

function rowText(id: GeneralRowId, text: GeneralTexts): { title: string; description: string; choiceLabels?: Readonly<Record<string, string>>; unsetLabel?: string } {
  switch (id) {
    case 'codingView': return { title: text.codingViewTitle, description: text.codingViewDescription }
    case 'transcriptView': return { title: text.transcriptViewTitle, description: text.transcriptViewDescription, choiceLabels: {
      compact: text.transcriptCompact, standard: text.transcriptStandard, detailed: text.transcriptDetailed, verbose: text.transcriptVerbose } }
    case 'collapseTiming': return { title: text.collapseTimingTitle, description: text.collapseTimingDescription, choiceLabels: {
      completion: text.collapseCompletion, 'next-input': text.collapseNextInput } }
    case 'language': return { title: text.languageTitle, description: text.languageDescription, unsetLabel: text.languageDevice,
      // Each language is named in itself, as the stock screen does.
      choiceLabels: { ja: '日本語', en: 'English', zh: '中文' } }
    case 'performanceUsage': return { title: text.performanceUsageTitle, description: text.performanceUsageDescription, choiceLabels: {
      compact: text.performanceCompact, detailed: text.performanceDetailed } }
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
    if (row.choices && field.kind === 'select' && !row.choices.every(choice => offered?.includes(choice))) return []
    const { title, description, choiceLabels, unsetLabel } = rowText(row.id, text)
    const stored = valueAt(namespace.value, [row.key])
    const values = [...(row.choices ?? []), ...(row.open && typeof stored === 'string' && !sameChoice(row, stored) ? [stored] : [])]
    const choices: { label: string; value: string | null }[] | undefined = row.choices && [
      ...(row.unsettable && unsetLabel !== undefined ? [{ label: unsetLabel, value: null }] : []),
      ...values.map(value => ({ label: choiceLabels?.[value] ?? value, value })),
    ]
    return [{
      id: row.id, namespace, field,
      display: { kind: row.kind, label: title, description, ...(choices ? { choices } : {}), effective: stored => effectiveValue(row, stored) },
    }]
  })
}
