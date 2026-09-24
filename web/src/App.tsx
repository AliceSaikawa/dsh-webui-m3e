import type { Context } from '@deepseek-ai/cordis'
import { uiChoiceCookie } from '../../src/shared/ui-choice.ts'
import { type ObservableSnapshot, useSnapshot } from './dsh/use-snapshot.ts'

type ConnectionState = 'connected' | 'disconnected' | 'connecting'

interface SessionSummary {
  id: string
  displayTitle: string
  running: boolean
  completed?: boolean
  blank: boolean
  updatedAt: number
}

interface SessionListState {
  ids: string[]
  byId: Record<string, SessionSummary>
  phase: string
}

/** The client services this screen reads, as restated from DSH 0.1.5-rc.2. */
interface Services {
  connection: { state: ObservableSnapshot<ConnectionState>; reconnect(): void }
  sessions: { list: ObservableSnapshot<SessionListState> }
}

/** Record the stock UI as this device's choice and go there. */
function backToClassic() {
  document.cookie = uiChoiceCookie('classic')
  location.assign('/')
}

/**
 * Transport check screen: connection state and the session list. The M3E
 * screens replace this once the transport is proven on a real Host.
 */
export function App({ ctx }: { ctx: Context }) {
  const services = ctx as unknown as Services
  const state = useSnapshot(services.connection.state)
  const list = useSnapshot(services.sessions.list)

  return (
    <main>
      <h1>DSH M3E</h1>
      <p>
        接続: <strong data-testid="connection-state">{state}</strong>{' '}
        <button type="button" onClick={() => services.connection.reconnect()}>
          再接続
        </button>
      </p>
      <p>
        一覧の状態: <span data-testid="list-phase">{list.phase}</span> / {list.ids.length} 件
      </p>
      <p>
        <button type="button" onClick={backToClassic}>
          今の画面に戻す
        </button>
      </p>
      <ul data-testid="session-list">
        {list.ids.map((id) => {
          const row = list.byId[id]
          if (row === undefined) return null
          return (
            <li key={id}>
              {row.displayTitle}
              {row.running ? '（実行中）' : ''}
              {row.blank ? '（空）' : ''}
            </li>
          )
        })}
      </ul>
    </main>
  )
}
