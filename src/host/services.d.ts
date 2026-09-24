/**
 * The slice of the Host services this plugin touches. DSH's own packages are
 * not dependencies of this repo, so the shapes are restated from
 * dsh-host-webserver and dsh-client-connection (DSH 0.1.5-rc.2).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer: {
      register(route: {
        kind: 'exact' | 'prefix'
        path: string
        handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
      }): () => void
      renderIndex(html: string): string
      tapIndex(transform: (html: string) => string): () => void
    }
    connection: {
      authorizeIndex(req: IncomingMessage, res: ServerResponse): boolean
    }
  }
}
