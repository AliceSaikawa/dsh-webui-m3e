import type { CSSProperties } from 'react'
import { DshProvider } from '../dsh/services.ts'
import { Theme } from './theme/index.ts'
import { OverlayHost, OverlayRouteScope, useOverlays } from './overlay/index.ts'
import { PageScaffold } from './shell/PageScaffold.tsx'
import { EdgeSwipeBack } from './shell/EdgeSwipeBack.tsx'
import { navigate, registerRoutes, useRoute } from './router.ts'
import { routes } from './routes.ts'
import { useViewport } from './viewport.ts'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import { ErrorState } from './ErrorState.tsx'
import { errorMessages } from './messages.ts'
import { useMessages } from '../i18n/index.ts'
import { ConversationSelection } from './use-conversation-selection.ts'
import { useRouteMotion } from './use-route-motion.ts'
import './styles.css'

registerRoutes(routes)
function Frame() {
  const route = useRoute()
  const error = useMessages(errorMessages)
  const routeRef = useRouteMotion(route.pathname)
  const viewport = useViewport()
  const overlays = useOverlays()
  return <div className="app-viewport" style={{ top: viewport.top, height: viewport.height, '--app-height': `${viewport.height}px` } as CSSProperties}>
    <ConversationSelection pathname={route.pathname} />
    <OverlayRouteScope path={`${route.pathname}${route.query.size ? `?${route.query.toString()}` : ''}`} />
    <div ref={routeRef} className="route-layer" inert={overlays.length > 0}><EdgeSwipeBack>{route.definition?.render(route.params) ?? <PageScaffold title={error.notFoundTitle}><ErrorState icon="travel_explore" title={error.notFoundTitle} message={error.notFoundMessage} actions={[{ label: error.home, primary: true, onClick: () => navigate('/', { replace: true }) }]} /></PageScaffold>}</EdgeSwipeBack></div>
    <OverlayHost />
  </div>
}
export function App({ ctx }: { ctx: unknown }) { return <ErrorBoundary><DshProvider ctx={ctx}><Theme><Frame /></Theme></DshProvider></ErrorBoundary> }
