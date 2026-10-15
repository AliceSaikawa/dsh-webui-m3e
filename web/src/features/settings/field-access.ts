import { MAX_SCHEMA_WORK, decodeSchema, schemaFields, type SchemaNode, type SettingField, type SettingPath, type SettingsNamespace } from './schema.ts'
import type { PermissionCatalog } from '../composer/api.ts'

const containsPath = (parent: SettingPath, child: SettingPath) => parent.length <= child.length && parent.every((key, index) => key === child[index])
class TooLarge extends Error {}
const samePath = (left: SettingPath, right: SettingPath) => left.length === right.length && containsPath(left, right)

export function findSettingField(namespace: SettingsNamespace, path: SettingPath, catalog?: PermissionCatalog): SettingField | undefined {
  function find(fields: SettingField[]): SettingField | undefined {
    for (const field of fields) {
      if (samePath(field.path, path)) return field
      const child = field.children && find(field.children)
      if (child) return child
    }
    return undefined
  }
  return find(schemaFields(namespace, catalog))
}

/** A whole-value reset must not also remove a protected or disabled descendant. */
export function settingFieldAccess(namespace: SettingsNamespace, field: SettingField): { edit: boolean; reset: boolean; resetBlocked: boolean } {
  const pathValid = field.path.length > 0 && field.path.every(key => key && !['__proto__', 'prototype', 'constructor'].includes(key))
  const edit = pathValid && !field.disabled && !['readonly', 'masked', 'group'].includes(field.kind)
  if (!pathValid || field.kind === 'masked' || !field.overridden) return { edit, reset: false, resetBlocked: false }
  const restricted: SettingPath[] = (namespace.secrets ?? []).map(entry => entry.path)
  let work = 0
  function collect(node: SchemaNode, path: string[]): void {
    // Shared definitions can expand exponentially; past the limit nothing is known.
    if (++work > MAX_SCHEMA_WORK) throw new TooLarge()
    // An unknown (truncated) definition may hide a protected or disabled item.
    if (node.truncated || node.meta?.disabled || node.meta?.role === 'password') { restricted.push(path); return }
    for (const [key, child] of Object.entries(node.dict ?? {})) collect(child, [...path, key])
    for (const child of new Set(node.list ?? [])) collect(child, path)
    // Collections have no independently editable rows, so any restricted item
    // protects the collection from a whole-value reset, including absent items.
    if (node.inner) collect(node.inner, path)
  }
  try { collect(decodeSchema(namespace.schema), []) } catch (error) {
    if (!(error instanceof TooLarge)) throw error
    return { edit, reset: false, resetBlocked: true }
  }
  const resetBlocked = restricted.some(path => containsPath(field.path, path) || containsPath(path, field.path))
  return { edit, reset: !field.disabled && !resetBlocked, resetBlocked }
}
