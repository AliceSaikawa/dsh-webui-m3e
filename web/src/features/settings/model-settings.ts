import type { ModelSelection } from '../composer/api.ts'
import { modelValue, type ModelChoice } from '../composer/model-picker.ts'
import type { SettingObject } from './schema.ts'
import type { SettingsOperation } from './store.ts'

export interface AllowedModel { provider: string; model: string }
export interface SubagentSelection { enabled: boolean; allowedModels: AllowedModel[] }

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined

export function savedModel(value: SettingObject): ModelSelection | undefined {
  return typeof value.provider === 'string' && typeof value.model === 'string'
    ? { provider: value.provider, model: value.model,
        ...(typeof value.reasoningEffort === 'string' ? { reasoningEffort: value.reasoningEffort } : {}) }
    : undefined
}

export function modelSelectionState(saved: ModelSelection | undefined, choices: readonly ModelChoice[]) {
  const value = modelValue(saved)
  const known = choices.some(choice => choice.value === value)
  return { value, unknownLabel: saved && !known ? `一覧にないモデル：${saved.provider} / ${saved.model}` : undefined }
}

export function chooseModel(choice: ModelChoice): ModelSelection {
  return { provider: choice.provider, model: choice.model.id,
    ...(choice.model.reasoning?.defaultEffort ? { reasoningEffort: choice.model.reasoning.defaultEffort } : {}) }
}

export function selectedEffort(saved: ModelSelection | undefined, choice: ModelChoice | undefined): string {
  return choice?.model.reasoning?.efforts.some(effort => effort.id === saved?.reasoningEffort)
    ? saved?.reasoningEffort ?? '' : ''
}

export function modelSaveOperations(next: ModelSelection): SettingsOperation[] {
  return [
    { op: 'set', path: ['provider'], value: next.provider },
    { op: 'set', path: ['model'], value: next.model },
    next.reasoningEffort === undefined
      ? { op: 'unset', path: ['reasoningEffort'] }
      : { op: 'set', path: ['reasoningEffort'], value: next.reasoningEffort },
  ]
}

export function subagentSelection(value: SettingObject): SubagentSelection {
  return {
    enabled: value.enabled === true,
    allowedModels: Array.isArray(value.allowedModels) ? value.allowedModels.flatMap(item => {
      const route = record(item)
      return typeof route?.provider === 'string' && typeof route.model === 'string'
        ? [{ provider: route.provider, model: route.model }] : []
    }) : [],
  }
}

export function toggleAllowedModel(current: readonly AllowedModel[], target: AllowedModel, checked: boolean): AllowedModel[] {
  const matches = (item: AllowedModel) => item.provider === target.provider && item.model === target.model
  return checked
    ? current.some(matches) ? [...current] : [...current, target]
    : current.filter(item => !matches(item))
}

export const modelResetOperations: SettingsOperation[] = [
  { op: 'unset', path: ['provider'] }, { op: 'unset', path: ['model'] }, { op: 'unset', path: ['reasoningEffort'] },
]
export const subagentResetOperations: SettingsOperation[] = [
  { op: 'unset', path: ['enabled'] }, { op: 'unset', path: ['allowedModels'] },
]
