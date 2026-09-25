import { Component, type ReactNode } from 'react'

export class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  override state = { hasError: false }

  static getDerivedStateFromError() { return { hasError: true } }

  override render() {
    if (!this.state.hasError) return this.props.children
    return <main className="app-error-screen">
      <div role="alert">
        <h1>画面を表示できませんでした</h1>
        <p>ページを読み直して、もう一度お試しください。</p>
      </div>
      <button type="button" autoFocus onClick={() => window.location.reload()}>読み直す</button>
    </main>
  }
}
