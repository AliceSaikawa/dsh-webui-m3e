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
    ?? reasoning?.defaultEffort ?? ''
}

export interface ModelApplySnapshot {
  readonly pending: boolean
  readonly composerBusy: boolean
  readonly selected?: ModelSelection
  readonly error?: unknown
}

/** One request per Composer, shared by every sheet opened for that Composer. */
export function createModelApplyController() {
  let snapshot: ModelApplySnapshot = { pending: false, composerBusy: false }
  const listeners = new Set<() => void>()
  const publish = (next: ModelApplySnapshot) => { snapshot = next; listeners.forEach(listener => listener()) }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    setComposerBusy(value: boolean) {
      if (snapshot.composerBusy !== value) publish({ ...snapshot, composerBusy: value })
    },
    async run(selection: ModelSelection, apply: (selection: ModelSelection) => Promise<ModelSelection>): Promise<ModelSelection> {
      if (snapshot.pending) throw new Error('モデルの選択を反映中です。')
      publish({ ...snapshot, pending: true, error: undefined })
      try {
        const selected = await apply(selection)
        publish({ ...snapshot, pending: false, selected, error: undefined })
        return selected
      } catch (error) {
        publish({ ...snapshot, pending: false, error })
        throw error
      }
    },
  }
}

export type ModelApplyController = ReturnType<typeof createModelApplyController>
