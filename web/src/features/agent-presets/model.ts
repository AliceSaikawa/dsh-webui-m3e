import type { AgentPresetRow } from './api.ts'
import type { ModeTexts } from './messages.ts'

/**
 * Presentation rules for the mode page. Built-in copy lives in the dictionary.
 * A preset that publishes its own name owns that copy and is never translated.
 */

const BUILT_IN_COPY = {
  standard: { name: 'presetStandardName', description: 'presetStandardDescription' },
  ptc: { name: 'presetPtcName', description: 'presetPtcDescription' },
  minimal: { name: 'presetMinimalName', description: 'presetMinimalDescription' },
  cordis: { name: 'presetCordisName', description: 'presetCordisDescription' },
} as const

type BuiltInId = keyof typeof BUILT_IN_COPY

export interface PresetDisplay {
  readonly name: string
  readonly description?: string
}

export interface PresetSection {
  readonly kind: 'built-in' | 'custom'
  readonly rows: readonly AgentPresetRow[]
}

export interface DefaultGate {
  readonly writable: boolean
  readonly revision: number | undefined
  readonly saving: boolean
}

/** A shipped preset publishes no name. A named row owns its copy, even on a shipped id. */
export function isBuiltInPreset(preset: { readonly id: string; readonly name?: string }): preset is { readonly id: BuiltInId } {
  return preset.name === undefined && Object.hasOwn(BUILT_IN_COPY, preset.id)
}

/** Built-in PTC and Minimal stay hidden while Coding Tools are off. Named overrides do not. */
export function requiresCodingTools(preset: { readonly id: string; readonly name?: string }): boolean {
  return isBuiltInPreset(preset) && (preset.id === 'ptc' || preset.id === 'minimal')
}

export function presetDisplayText(preset: { readonly id: string; readonly name?: string; readonly description?: string }, text: ModeTexts): PresetDisplay {
  if (isBuiltInPreset(preset)) {
    const keys = BUILT_IN_COPY[preset.id]
    return { name: text[keys.name], description: text[keys.description] }
  }
  return {
    name: preset.name ?? preset.id,
    ...(preset.description !== undefined ? { description: preset.description } : {}),
  }
}

/** Roster order, with empty groups left out. A hidden built-in that is already the default stays visible. */
export function presetSections(rows: readonly AgentPresetRow[], codingToolsEnabled: boolean): readonly PresetSection[] {
  const shown = codingToolsEnabled ? rows : rows.filter(row => row.isDefault || !requiresCodingTools(row))
  const builtIn = shown.filter(isBuiltInPreset)
  const custom = shown.filter(row => !isBuiltInPreset(row))
  return [
    ...(builtIn.length > 0 ? [{ kind: 'built-in' as const, rows: builtIn }] : []),
    ...(custom.length > 0 ? [{ kind: 'custom' as const, rows: custom }] : []),
  ]
}

/** A broken preset stays on the page for its diagnostic, and cannot become the default. */
export function canMakeDefault(row: AgentPresetRow, gate: DefaultGate): boolean {
  return row.broken === undefined && !row.isDefault && gate.writable && gate.revision !== undefined && !gate.saving
}

/**
 * A rejection written for people (Japanese letters and Japanese punctuation
 * only) is shown as is. Anything else can carry paths or input, so it gets
 * the fixed message. Same rule as the settings form.
 */
export function hostNotice(message: unknown, fallback: string): string {
  return typeof message === 'string' && message.length <= 200
    && /^[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff01\uff08\uff09\uff1a\uff1f]+$/u.test(message)
    && /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/u.test(message) ? message : fallback
}
