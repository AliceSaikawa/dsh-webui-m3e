import type { CSSProperties } from 'react'
import 'material-symbols/outlined.css'

export function Icon({ name, slot, filled = false, className = '' }: {
  name: string; slot?: string; filled?: boolean; className?: string
}) {
  return <span slot={slot} aria-hidden="true" className={`material-symbols-outlined ${className}`}
    style={{ fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' 24` } as CSSProperties}>{name}</span>
}
