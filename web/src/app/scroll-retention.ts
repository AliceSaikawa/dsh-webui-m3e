export interface ScrollTarget {
  readonly scrollTop: number
  readonly scrollLeft: number
  scrollTo(options: { top: number; left: number; behavior: 'instant' }): void
}
export interface ScrollPosition<T extends ScrollTarget> { target: T; top: number; left: number }

/** Capture before hiding; callers pass the panel and marked nested scroll areas. */
export function rememberScrollPositions<T extends ScrollTarget>(targets: Iterable<T>): ScrollPosition<T>[] {
  return Array.from(targets, (target) => ({ target, top: target.scrollTop, left: target.scrollLeft }))
    .filter(({ top, left }) => top !== 0 || left !== 0)
}

export function restoreScrollPositions<T extends ScrollTarget>(positions: readonly ScrollPosition<T>[], contains: (target: T) => boolean): void {
  for (const { target, top, left } of positions) {
    if (contains(target)) target.scrollTo({ top, left, behavior: 'instant' })
  }
}
