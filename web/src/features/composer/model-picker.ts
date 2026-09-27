import type { ModelCatalog, ModelCatalogModel, ModelSelection } from './api.ts'

export interface ModelChoice {
  value: string
  label: string
  provider: string
  model: ModelCatalogModel
}

export function modelChoices(catalog: ModelCatalog): ModelChoice[] {
  return catalog.groups.flatMap(group => group.models.map(model => ({
    value: `${group.id.length}:${group.id}${model.id}`,
    label: `${group.name} / ${model.name}`,
    provider: group.id,
    model,
  })))
}

export function modelValue(selection: ModelSelection | null | undefined): string {
  return selection ? `${selection.provider.length}:${selection.provider}${selection.model}` : ''
}

export function selectionFromModelValue(value: string, choices: readonly ModelChoice[]): ModelSelection | undefined {
  const choice = choices.find(item => item.value === value)
  return choice && { provider: choice.provider, model: choice.model.id }
}

export function reasoningForSelection(selection: ModelSelection | null | undefined, choices: readonly ModelChoice[]) {
  return choices.find(choice => choice.value === modelValue(selection))?.model.reasoning
}

export function effortValue(selection: ModelSelection | null | undefined, choices: readonly ModelChoice[]): string {
  const reasoning = reasoningForSelection(selection, choices)
  return reasoning?.efforts.find(effort => effort.id === selection?.reasoningEffort)?.id
    ?? reasoning?.defaultEffort ?? reasoning?.efforts[0]?.id ?? ''
}
