/**
 * The slice of the Host services this plugin touches. DSH's own packages are
 * not dependencies of this repo, so the shapes are restated from
 * dsh-host-webserver and dsh-client-connection (DSH 0.2.0-rc.2).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

/** Request facts browser authentication reads (dsh-client-connection's ConnectionIndexRequest). */
interface ConnectionIndexRequest {
  readonly method?: string | undefined
  readonly url?: string | undefined
  readonly headers: IncomingMessage['headers']
}

/**
 * Response operations browser authentication owns while it refuses an index
 * request (dsh-client-connection's ConnectionIndexResponse). It writes at most
 * one `writeHead` and one `end` before returning false, so a caller may pass a
 * substitute and replay those two calls itself.
 */
interface ConnectionIndexResponse {
  writeHead(status: number, headers?: Readonly<Record<string, string>>): unknown
  end(body?: string): unknown
}

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
      /**
       * Authenticate one frontend index request, owning a token redirect or 401.
       * @param request - root or configured-index HTTP request.
       * @param response - response owned when the result is false.
       * @returns true only when the frontend may serve index.html.
       */
      authorizeIndex(request: ConnectionIndexRequest, response: ConnectionIndexResponse): boolean
    }
  }
}
