import { Icon } from './icons/Icon.tsx'

export interface ErrorAction {
  label: string
  onClick(): void
  primary?: boolean
}

/**
 * One error screen for every failure that used to be ad-hoc markup. Native
 * buttons (not m3e components) keep the boundary usable when custom elements
 * are broken. It shows the cause and the next action, never the raw error.
 * Only the full-screen form takes focus; inside a route it would steal focus
 * from the page's own controls. The full-screen form replaces the whole app,
 * so it is the page's `main` landmark with an `h1`; inside a route it sits in
 * the page's own `main` under the page's `h1`, so it uses an `h2`.
 */
export function ErrorState({ icon, title, message, actions, fullScreen = false }: {
  icon: string
  title: string
  message: string
  actions: readonly ErrorAction[]
  fullScreen?: boolean
}) {
  const primary = actions.findIndex(action => action.primary)
  const Heading = fullScreen ? 'h1' : 'h2'
  const content = <div className="error-state" role="alert">
    <Icon className="error-state-icon" name={icon} />
    <Heading>{title}</Heading>
    <p>{message}</p>
    <div className="error-state-actions">{actions.map((action, index) => <button key={index} type="button"
      autoFocus={fullScreen && index === primary} className={action.primary ? 'error-state-primary' : undefined}
      onClick={action.onClick}>{action.label}</button>)}</div>
  </div>
  // role="alert" on the main element itself would replace its landmark role.
  return fullScreen ? <main className="error-state-full">{content}</main> : content
}
