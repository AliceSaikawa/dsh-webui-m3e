import type { RouteDef } from '../../app/router.ts'

function Thrower(): never {
  throw new Error('mock render error')
}

// Dev-only preview of the render-failure screen. Unknown routes preview the
// not-found screen with any unknown hash (for example #/__mock/not-found).
const preview = import.meta.env.DEV && new URLSearchParams(location.search).has('mock')

export const routes: RouteDef[] = preview
  ? [{ path: '/__mock/render-error', render: () => <Thrower /> }]
  : []
