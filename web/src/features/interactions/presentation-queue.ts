type Close = () => void
interface Presentation {
  key: string
  open(close: Close): Close
  close: Close
  closeOverlay?: Close
}

/** Only one response sheet is mounted; later presentations keep their arrival order. */
export class PresentationQueue {
  #entries: Presentation[] = []

  present(key: string, open: Presentation['open']): Close {
    const existing = this.#entries.find(entry => entry.key === key)
    if (existing) return existing.close
    const entry: Presentation = { key, open, close: () => {
      const index = this.#entries.indexOf(entry)
      if (index < 0) return
      this.#entries.splice(index, 1)
      entry.closeOverlay?.()
      if (index === 0) this.#showFirst()
    } }
    this.#entries.push(entry)
    if (this.#entries.length === 1) this.#showFirst()
    return entry.close
  }

  pruneQueued(keys: ReadonlySet<string>): void {
    for (const entry of this.#entries.slice(1)) if (!keys.has(entry.key)) entry.close()
  }

  #showFirst(): void {
    const first = this.#entries[0]
    if (first && !first.closeOverlay) first.closeOverlay = first.open(first.close)
  }
}
