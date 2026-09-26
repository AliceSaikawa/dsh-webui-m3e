import type { CSSProperties } from 'react'
import { DshProvider } from '../dsh/services.ts'
import { Theme } from './theme/index.ts'
import { OverlayHost, OverlayRouteScope, useOverlays } from './overlay/index.ts'
import { PageScaffold } from './shell/PageScaffold.tsx'
import { EdgeSwipeBack } from './shell/EdgeSwipeBack.tsx'
import { registerRoutes, useRoute } from './router.ts'
import { routes } from './routes.ts'
import { useViewport } from './viewport.ts'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import { ConversationSelection } from './use-conversation-selection.ts'
import { useRouteMotion } from './use-route-motion.ts'
import './styles.css'

registerRoutes(routes)
function Frame() {
  const route = useRoute()
  const routeRef = useRouteMotion(route.pathname)
  const viewport = useViewport()
  const overlays = useOverlays()
  return <div className="app-viewport" style={{ top: viewport.top, height: viewport.height, '--app-height': `${viewport.height}px` } as CSSProperties}>
    <ConversationSelection pathname={route.pathname} />
    <OverlayRouteScope path={`${route.pathname}${route.query.size ? `?${route.query.toString()}` : ''}`} />
    <div ref={routeRef} className="route-layer" inert={overlays.length > 0}><EdgeSwipeBack>{route.definition?.render(route.params) ?? <PageScaffold title="画面が見つかりません"><p className="page-padding">戻るボタンで一覧に戻れます</p></PageScaffold>}</EdgeSwipeBack></div>
    <OverlayHost />
  </div>
}
export function App({ ctx }: { ctx: unknown }) { return <ErrorBoundary><DshProvider ctx={ctx}><Theme><Frame /></Theme></DshProvider></ErrorBoundary> }
