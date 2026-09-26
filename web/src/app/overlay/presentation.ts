export interface OverlaySurface {
  show(): Promise<void>
  hide(): Promise<void>
}

/** M3E modal teardown must finish before another modal takes focus or scroll locks. */
export class OverlayPresentation {
  private readonly surfaces = new Map<number, OverlaySurface>()
  private target: number | undefined
  private active: number | undefined
  private closing: number | undefined
  private running = false
  private released: (id: number) => void

  constructor(released: (id: number) => void) { this.released = released }
  get activeId(): number | undefined { return this.active }
  isUserClose(id: number): boolean { return this.active === id && this.closing !== id }
  register(id: number, surface: OverlaySurface): () => void {
    this.surfaces.set(id, surface)
    void this.advance()
    return () => { this.surfaces.delete(id) }
  }
  select(id: number | undefined): void {
    this.target = id
    void this.advance()
  }
  private async advance(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.active !== this.target) {
        if (this.active !== undefined) {
          const id = this.active
          this.closing = id
          await this.surfaces.get(id)?.hide()
          this.active = undefined
          this.closing = undefined
          this.released(id)
        }
        const id = this.target
        if (id === undefined) break
        const surface = this.surfaces.get(id)
        if (!surface) break
        this.active = id
        await surface.show()
      }
    } catch (error) {
      console.error('シートの表示を切り替えられませんでした。', error)
    } finally {
      this.running = false
    }
  }
}

interface SheetSurface extends EventTarget {
  open: boolean
  updateComplete: Promise<unknown>
  matches(selector: string): boolean
}

/** `closed` fires before the sheet releases its native popover, inert and scroll locks. */
export async function hideSheet(surface: SheetSurface): Promise<void> {
  let finish!: () => void
  const closed = new Promise<void>(resolve => { finish = resolve })
  const toggled = () => { if (!surface.matches(':popover-open')) finish() }
  surface.addEventListener('toggle', toggled)
  try {
    surface.open = false
    await surface.updateComplete
    if (surface.matches(':popover-open')) await closed
  } finally {
    surface.removeEventListener('toggle', toggled)
  }
}

export function setSheetHandle(element: { toggleAttribute(name: string, force?: boolean): boolean }, enabled: boolean): void {
  // M3E's property is not reflected, but its CSS requires the HTML attribute.
  element.toggleAttribute('handle', enabled)
}
