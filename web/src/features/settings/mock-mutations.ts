import type { SettingObject, SettingValue, SettingsNamespace } from './schema.ts'
import type { SettingsOperation } from './store.ts'

const object = (value: unknown): value is SettingObject => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Ordered edits, including array append/replacement and splice removal. The
 * untouched inherited fields remain outside the fixture's user override. */
export function applyMockOperations(row: SettingsNamespace, operations: readonly SettingsOperation[]): SettingObject {
  const user = structuredClone(row.user ?? {})
  function edit(input: SettingValue | undefined, path: readonly string[], operation: SettingsOperation): SettingValue | undefined {
    const [head, ...rest] = path
    if (head === undefined) return operation.op === 'set' ? structuredClone(operation.value) : undefined
    if (['__proto__', 'prototype', 'constructor'].includes(head)) throw new Error('設定項目の場所が不正です。')
    if (Array.isArray(input)) {
      const index = Number(head)
      if (!/^(0|[1-9][0-9]*)$/.test(head) || index > input.length
        || index === input.length && (rest.length > 0 || operation.op === 'unset')) throw new Error('配列の位置が範囲外です。')
      const next = [...input]
      if (!rest.length && operation.op === 'unset') next.splice(index, 1)
      else next[index] = edit(input[index], rest, operation)!
      return next
    }
    const next = object(input) ? { ...input } : {}
    const child = edit(next[head], rest, operation)
    if (child === undefined || operation.op === 'unset' && object(child) && !Object.keys(child).length) delete next[head]
    else next[head] = child
    return next
  }
  for (const operation of operations) {
    const [key, ...rest] = operation.path
    if (!key) throw new Error('設定項目の場所が不正です。')
    const input = Object.hasOwn(user, key) ? user[key] : row.value[key]
    const next = edit(input, rest, operation)
    if (next === undefined || operation.op === 'unset' && object(next) && !Object.keys(next).length) delete user[key]
    else user[key] = next
  }
  return user
}

/** A repeated write must complete without depending on a broadcast. */
export function mockSettingsChanged(row: SettingsNamespace, user: SettingObject): boolean {
  return JSON.stringify(row.user ?? {}) !== JSON.stringify(user)
}
