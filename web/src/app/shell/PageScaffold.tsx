import type { ReactNode } from 'react'
import { M3eIconButton } from '@m3e/react/icon-button'
import { Icon } from '../icons/Icon.tsx'
import { back } from '../router.ts'
import { ConnectionBanner } from './ConnectionBanner.tsx'

export function PageScaffold({ title, children, actions, footer }: { title: string; children: ReactNode; actions?: ReactNode; footer?: ReactNode }) {
  return <section className="screen page-screen"><header className="top-bar"><M3eIconButton aria-label="戻る" onClick={back}><Icon name="arrow_back" /></M3eIconButton><h1>{title}</h1>{actions}</header>
    <ConnectionBanner /><main className="screen-content" data-scroll-area>{children}</main>{footer && <footer className="page-footer">{footer}</footer>}
  </section>
}
