import { Component, type ReactNode } from 'react'
import { currentLocale, messagesOf } from '../i18n/index.ts'
import { ErrorState } from './ErrorState.tsx'
import { errorMessages } from './messages.ts'

export class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  override state = { hasError: false }

  static getDerivedStateFromError() { return { hasError: true } }

  override componentDidCatch(error: Error) { console.error(error) }

  override render() {
    if (!this.state.hasError) return this.props.children
    const text = messagesOf(errorMessages, currentLocale())
    return <ErrorState fullScreen icon="error" title={text.renderTitle} message={text.renderMessage} actions={[
      { label: text.reload, primary: true, onClick: () => window.location.reload() },
      { label: text.home, onClick: () => { window.location.hash = '#/'; window.location.reload() } },
    ]} />
  }
}
