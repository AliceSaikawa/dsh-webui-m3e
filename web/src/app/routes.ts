import type { RouteDef } from './router.ts'

const development = import.meta.env.DEV
const modules = import.meta.glob<{ routes: RouteDef[] }>('../features/*/routes.tsx', { eager: true })
const paths = new Set<string>()
export const routes = Object.entries(modules).sort(([a], [b]) => a.localeCompare(b)).flatMap(([file, module]) => {
  return module.routes.filter((route) => {
    if (paths.has(route.path)) {
      if (development) console.warn(`画面のパスが重複しています: ${route.path} (${file})`)
      return false
    }
    paths.add(route.path)
    return true
  })
})
