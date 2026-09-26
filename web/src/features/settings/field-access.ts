import { decodeSchema, schemaFields, type SchemaNode, type SettingField, type SettingPath, type SettingsNamespace } from './schema.ts'

const containsPath = (parent: SettingPath, child: SettingPath) => parent.length <= child.length && parent.every((key, index) => key === child[index])
const samePath = (left: SettingPath, right: SettingPath) => left.length === right.length && containsPath(left, right)

export function findSettingField(namespace: SettingsNamespace, path: SettingPath): SettingField | undefined {
  function find(fields: SettingField[]): SettingField | undefined {
    for (const field of fields) {
      if (samePath(field.path, path)) return field
      const child = field.children && find(field.children)
      if (child) return child
    }
    return undefined
  }
  return find(schemaFields(namespace))
}

/** A whole-value reset must not also remove a protected or disabled descendant. */
export function settingFieldAccess(namespace: SettingsNamespace, field: SettingField): { edit: boolean; reset: boolean; resetBlocked: boolean } {
  const pathValid = field.path.length > 0 && field.path.every(key => key && !['__proto__', 'prototype', 'constructor'].includes(key))
  const edit = pathValid && !field.disabled && !['readonly', 'masked', 'group'].includes(field.kind)
  if (!pathValid || field.kind === 'masked' || !field.overridden) return { edit, reset: false, resetBlocked: false }
  const restricted: SettingPath[] = (namespace.secrets ?? []).map(entry => entry.path)
  function collect(node: SchemaNode, path: string[]): void {
    if (node.meta?.disabled || node.meta?.role === 'password') { restricted.push(path); return }
    for (const [key, child] of Object.entries(node.dict ?? {})) collect(child, [...path, key])
    for (const child of node.list ?? []) collect(child, path)
    // Collections have no independently editable rows, so any restricted item
    // protects the collection from a whole-value reset, including absent items.
    if (node.inner) collect(node.inner, path)
  }
  collect(decodeSchema(namespace.schema), [])
  const resetBlocked = restricted.some(path => containsPath(field.path, path) || containsPath(path, field.path))
  return { edit, reset: !field.disabled && !resetBlocked, resetBlocked }
}
