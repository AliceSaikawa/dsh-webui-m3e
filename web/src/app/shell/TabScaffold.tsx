import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { M3eNavBar, M3eNavItem } from '@m3e/react/nav-bar'
import { Icon } from '../icons/Icon.tsx'
import { navigate, useRoute, type Tab } from '../router.ts'
import { useInboxCount } from '../../features/inbox/count.ts'
import { useMessages } from '../../i18n/index.ts'
import { shellMessages } from '../messages.ts'
import { ConnectionBanner } from './ConnectionBanner.tsx'

const destinations: { tab: Tab; path: string; label: 'homeTab' | 'searchTab' | 'inboxTab' | 'settingsTab'; icon: string }[] = [
  { tab: 'home', path: '/', label: 'homeTab', icon: 'home' },
  { tab: 'search', path: '/search', label: 'searchTab', icon: 'search' },
  { tab: 'inbox', path: '/inbox', label: 'inboxTab', icon: 'front_hand' },
  { tab: 'settings', path: '/settings', label: 'settingsTab', icon: 'settings' },
]
export interface TabScaffoldProps { title?: string; topBar?: ReactNode; children: ReactNode; fab?: ReactNode; tab?: Tab }
export function TabScaffold({ title, topBar, children, fab, tab }: TabScaffoldProps) {
  const text = useMessages(shellMessages)
  const route = useRoute()
  const count = useInboxCount()
  const selected = tab ?? route.tab
  const navigation = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const node = navigation.current
    if (!node) return
    // Snackbars live outside the app tree. Measure the actual bar, including
    // its safe-area padding, so font/viewport changes cannot create overlap.
    const root = document.documentElement.style
    let observing = true
    const update = () => {
      if (observing) root.setProperty('--app-bottom-navigation-height', `${node.getBoundingClientRect().height}px`)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => { observing = false; observer.disconnect(); root.removeProperty('--app-bottom-navigation-height') }
  }, [])
  return <section className="screen tab-screen">
    <header className="top-bar">{topBar ?? <h1>{title}</h1>}</header>
    <ConnectionBanner />
    <main className="screen-content tab-content" data-scroll-area>{children}</main>
    {fab && <div className="fab-slot">{fab}</div>}
    <nav ref={navigation} className="bottom-navigation" aria-label={text.mainNavigation}><M3eNavBar mode="compact">
      {destinations.map(item => <M3eNavItem key={item.tab} selected={selected === item.tab} aria-current={selected === item.tab ? 'page' : undefined}
        aria-label={item.tab === 'inbox' && count > 0 ? text.inboxTabWithCount(count) : text[item.label]} onClick={() => navigate(item.path, { replace: true })}>
        <span slot="icon" className="nav-icon"><Icon name={item.icon} filled={selected === item.tab} />{item.tab === 'inbox' && count > 0 && <span className="count-badge">{count > 99 ? '99+' : count}</span>}</span>
        {text[item.label]}
      </M3eNavItem>)}
    </M3eNavBar></nav>
  </section>
}
