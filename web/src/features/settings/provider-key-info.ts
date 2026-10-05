import type { RemoteResult } from '../../dsh/services.ts'

/** The Host accepts at most 64 references per lookup. A failed batch leaves
 * only its own rows unknown; successful batches keep their normal operations. */
export async function describeKeyBatches(refs: string[], lookup: (refs: string[]) => Promise<RemoteResult<Record<string, unknown>>>): Promise<Record<string, unknown>> {
  const entries: [string, unknown][] = []
  for (let offset = 0; offset < refs.length; offset += 64) {
    const batch = refs.slice(offset, offset + 64)
    try {
      const answer = await lookup(batch)
      if (answer.ok) for (const ref of batch) {
        if (Object.hasOwn(answer.value, ref)) entries.push([ref, answer.value[ref]])
      }
    } catch { /* The next batch can still be available. */ }
  }
  return Object.fromEntries(entries)
}
