/**
 * The `__DSH_BOOT__` graph the Host injects into every index, and how this UI
 * narrows it. Kept free of runtime imports so it can be tested under Node.
 */

export interface BootEntry {
  id: string
  url: string
  rev: string
  inject?: string[]
  immediately?: boolean
  external?: string[]
}

export interface BootBatch {
  phase: 'bootstrap' | 'application'
  url: string
  rev: string
  entries: string[]
}

export interface BootGraph {
  rev: string
  entries: BootEntry[]
  batches: BootBatch[]
}

/**
 * Narrow the Host's boot graph to the wanted plugins plus their inject closure.
 * Each kept application entry gets its own one-resource combo URL: the Host
 * serves those, while an ad-hoc multi-entry combo would 404.
 * @param graph - the `__DSH_BOOT__` graph as injected.
 * @param wanted - plugin ids to keep.
 * @returns a graph the module system accepts: the untouched bootstrap batch and one application batch per kept entry.
 */
export function narrowBootGraph(graph: BootGraph, wanted: readonly string[]): BootGraph {
  const byId = new Map(graph.entries.map((entry) => [entry.id, entry]))
  const kept = new Set<string>()
  const visit = (id: string) => {
    if (kept.has(id)) return
    const entry = byId.get(id)
    if (entry === undefined) return
    kept.add(id)
    for (const dep of entry.inject ?? []) visit(dep)
  }
  for (const id of wanted) {
    if (!byId.has(id)) throw new Error(`webui-m3e: the Host boot graph has no ${id}`)
    visit(id)
  }

  const bootstrap = graph.batches.filter((batch) => batch.phase === 'bootstrap')
  const inBootstrap = new Set(bootstrap.flatMap((batch) => batch.entries))
  const entries = graph.entries.filter((entry) => kept.has(entry.id))
  const application: BootBatch[] = entries
    .filter((entry) => !inBootstrap.has(entry.id))
    .map((entry) => ({ phase: 'application', url: entry.url, rev: entry.rev, entries: [entry.id] }))
  return { rev: graph.rev, entries, batches: [...bootstrap, ...application] }
}
