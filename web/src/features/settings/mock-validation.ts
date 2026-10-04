import { decodeSchema, type SchemaNode, type SettingValue, type SettingsNamespace } from './schema.ts'
import type { SettingsOperation } from './store.ts'

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const safe = (key: string) => !['__proto__', 'prototype', 'constructor'].includes(key)

/** Fixture schemas declare the editable form only, just like settings.describe.
 * Kept separate so the protected fixture owner can wire it in with the handoff patch.
 */
function accepts(node: SchemaNode, value: unknown, partial = false): boolean {
  const lengthOk = (length: number) => (node.meta?.min === undefined || length >= node.meta.min) && (node.meta?.max === undefined || length <= node.meta.max)
  switch (node.type) {
    case 'object': return object(value)
      && (partial || Object.entries(node.dict ?? {}).every(([key, child]) => !child.meta?.required || Object.hasOwn(value, key)))
      && Object.entries(value).every(([key, child]) => safe(key) && !!node.dict?.[key] && accepts(node.dict[key], child, partial))
    case 'dict': return object(value) && !!node.inner && Object.entries(value).every(([key, child]) => safe(key) && (!node.sKey || accepts(node.sKey, key)) && accepts(node.inner!, child, partial))
    case 'array': return Array.isArray(value) && lengthOk(value.length) && !!node.inner && value.every(child => accepts(node.inner!, child))
    case 'string': return typeof value === 'string' && lengthOk(value.length)
      && (!node.meta?.pattern || new RegExp(node.meta.pattern.source, node.meta.pattern.flags).test(value))
    case 'number': return typeof value === 'number' && Number.isFinite(value)
      && (node.meta?.min === undefined || value >= node.meta.min) && (node.meta?.max === undefined || value <= node.meta.max)
      && (node.meta?.step === undefined || Math.abs((value - (node.meta.min ?? 0)) / node.meta.step - Math.round((value - (node.meta.min ?? 0)) / node.meta.step)) < 1e-8)
    case 'boolean': return typeof value === 'boolean'
    case 'const': return Object.is(node.value, value)
    case 'union': return node.list?.some(child => accepts(child, value, partial)) === true
    case 'intersect': return node.list?.every(child => accepts(child, value, partial)) === true
    // Only explicitly declared opaque fixture fields accept arbitrary JSON.
    case 'custom': return true
    default: return false
  }
}
function nodeAt(node: SchemaNode, path: readonly string[]): SchemaNode | undefined {
  if (!path.length) return node
  const [key, ...rest] = path
  if (!key || !safe(key)) return undefined
  if (node.type === 'intersect') return node.list?.map(child => nodeAt(child, path)).find(Boolean)
  const child = node.type === 'object' ? node.dict?.[key]
    : node.type === 'dict' ? node.inner
    : node.type === 'array' && /^(0|[1-9][0-9]*)$/.test(key) ? node.inner : undefined
  return child && nodeAt(child, rest)
}
export function validMockPatch(row: SettingsNamespace, patch: Record<string, SettingValue>): boolean {
  return accepts(decodeSchema(row.schema), patch, true)
}
/** Validate the merged document too: a partial patch can introduce a new object. */
export function validMockValue(row: SettingsNamespace, value: Record<string, SettingValue>): boolean {
  return accepts(decodeSchema(row.schema), value)
}
export function validMockOperations(row: SettingsNamespace, operations: readonly SettingsOperation[]): boolean {
  const root = decodeSchema(row.schema)
  return operations.every(operation => {
    const node = nodeAt(root, operation.path)
    return !!node && (operation.op === 'unset' || operation.op === 'set' && accepts(node, operation.value))
  })
}
