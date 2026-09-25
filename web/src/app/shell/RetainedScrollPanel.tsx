import { Component, createRef, type ReactNode } from 'react'
import { rememberScrollPositions, restoreScrollPositions, type ScrollPosition } from '../scroll-retention.ts'

interface Props { active: boolean; label: string; children: ReactNode }

/** DOM snapshots must run before React applies hidden, not in effect cleanup. */
export class RetainedScrollPanel extends Component<Props> {
  private readonly panel = createRef<HTMLDivElement>()
  private positions: ScrollPosition<HTMLElement>[] = []

  getSnapshotBeforeUpdate(previous: Props): ScrollPosition<HTMLElement>[] | null {
    const root = this.panel.current
    if (!root || !previous.active || this.props.active) return null
    return rememberScrollPositions([root, ...root.querySelectorAll<HTMLElement>('[data-scroll-area]')])
  }

  componentDidUpdate(previous: Props, _state: unknown, snapshot: ScrollPosition<HTMLElement>[] | null): void {
    if (snapshot !== null) this.positions = snapshot
    if (!previous.active && this.props.active) {
      const root = this.panel.current
      if (root) restoreScrollPositions(this.positions, (target) => root.contains(target))
      this.positions = []
    }
  }

  render() {
    const { active, label, children } = this.props
    return <div ref={this.panel} className="conversation-panel" role="tabpanel" aria-label={label}
      hidden={!active} inert={!active} data-scroll-area={active ? true : undefined}>{children}</div>
  }
}
