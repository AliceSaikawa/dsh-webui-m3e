/** Test-only wire reader. It never calls the application's decodeSchema. */
export function expectedSchemaShape(input: unknown): unknown {
  type Node = { type: string; value?: unknown; meta?: Record<string, unknown>; dict?: Record<string, number>; list?: number[]; inner?: number; sKey?: number }
  const wire = input as { uid: number; refs: Record<number, Node> }
  function visit(id: number, parents: number[] = []): unknown {
    if (parents.includes(id) || !wire.refs[id]) throw new Error(`Invalid fixture schema reference: ${id}`)
    const node = wire.refs[id]
    const next = [...parents, id]
    return {
      type: node.type, value: node.value,
      meta: Object.fromEntries(['required', 'min', 'max', 'step', 'pattern'].filter(key => node.meta?.[key] !== undefined).map(key => [key, node.meta![key]])),
      dict: node.dict && Object.fromEntries(Object.entries(node.dict).map(([key, value]) => [key, visit(value, next)])),
      list: node.list?.map(value => visit(value, next)),
      inner: node.inner === undefined ? undefined : visit(node.inner, next),
      sKey: node.sKey === undefined ? undefined : visit(node.sKey, next),
    }
  }
  return visit(wire.uid)
}
