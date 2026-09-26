import { modelIcon, type ModelIcon } from '../home/data.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Use the last model that ran, with the same icon rules as the session list. */
export function selectSearchModelIcon(projectionValues: unknown): ModelIcon {
  const selection = isRecord(projectionValues) ? projectionValues.modelSelection : undefined
  return modelIcon(isRecord(selection) ? selection.lastUsed : undefined)
}
