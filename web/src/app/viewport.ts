import { useEffect, useState } from 'react'

export interface Viewport { top: number; height: number }
export function readViewport(): Viewport {
  return { top: window.visualViewport?.offsetTop ?? 0, height: window.visualViewport?.height ?? window.innerHeight }
}
export function useViewport(): Viewport {
  const [viewport, setViewport] = useState(readViewport)
  useEffect(() => {
    const update = () => setViewport(readViewport())
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    update()
    return () => {
      window.visualViewport?.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])
  return viewport
}
