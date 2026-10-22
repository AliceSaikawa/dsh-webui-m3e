/**
 * dsh-webui-m3e — Host half. Serves the built M3E Web UI under `/m3e` beside
 * the stock UI, which keeps the webserver fallback seat, and taps a small
 * script into every index head that sends a device which chose M3E from the
 * stock index to `/m3e/` (see ../shared/ui-choice.ts).
 *
 * The index goes through the same gate as the stock UI: Connection's browser
 * authentication, then the webserver's index render, which injects the module
 * loader facade and the `__DSH_BOOT__` graph the page boots from. The advisory
 * preloads for the stock UI's application combos are removed, because this UI
 * loads only the transport plugins and a phone should not fetch the rest.
 *
 * Connection's plain refusal is one line of English text, which a phone shows
 * when a restored tab replays the request without its `SameSite=Strict` cookie
 * (Issue #91). M3E therefore hands `authorizeIndex` a recording response and
 * answers that single case with its own explanation page; every other decision
 * Connection makes is replayed to the socket unchanged.
 */
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { uiChoiceScript } from '../shared/ui-choice.ts'
import { documentLanguage, requestedLocale, type Locale } from '../../web/src/i18n/locale.ts'

export const name = 'webui-m3e'
export const inject = ['webServer', 'connection']

/** URL prefix the UI lives under; must equal Vite's `base` without the trailing slash. */
export const MOUNT = '/m3e'

const DIST_ROOT = resolve(fileURLToPath(new URL('../dist/', import.meta.url)))
const DIST_INDEX = join(DIST_ROOT, 'index.html')

const HTML_MIME = 'text/html; charset=utf-8'
const MIME: Record<string, string> = {
  '.html': HTML_MIME,
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
}
const MISS_CODES = new Set(['ENOENT', 'EISDIR', 'ENOTDIR'])

/** Advisory preload rows for the stock UI's application combos. */
const APPLICATION_PRELOAD = /<link rel="preload" as="script" href="\/?plugins\/[^"]*"[^>]*>/g

/**
 * Remove the stock UI's application combo preloads from a rendered index.
 * @param html - index body after the webserver's render.
 * @returns the body without application preloads.
 */
export function stripApplicationPreloads(html: string): string {
  return html.replace(APPLICATION_PRELOAD, '')
}

/**
 * DSH 0.2 resolves plugin bundles, RPC, streams and upload workers against the
 * document base. Keep its native transports by resolving them at the Host root.
 * renderIndex prepends the bootstrap, so move our template's base ahead of it.
 * This postprocessing belongs only to /m3e; tapIndex also runs on the stock UI.
 */
export function prepareM3eIndex(html: string): string {
  return stripApplicationPreloads(html)
    .replace(/<base href="\/"\s*\/?>/g, '')
    .replace(/<head(?:\s[^>]*)?>/i, (open) => `${open}<base href="/">`)
}

/**
 * Put the UI choice script first in the head, so it runs before any stock
 * script is fetched or evaluated.
 * @param html - an index body.
 * @returns the body with the script right after the opening head tag.
 */
export function injectUiChoice(html: string): string {
  return html.replace(/<head(?:\s[^>]*)?>/i, (open) => `${open}<script>${uiChoiceScript()}</script>`)
}

/**
 * Map a request pathname under {@link MOUNT} to a file inside the dist root.
 * @param pathname - decoded request pathname.
 * @returns the absolute target, `'index'` for the entry page, or undefined when it escapes the root.
 */
export function resolveTarget(pathname: string): string | 'index' | undefined {
  const rest = pathname.slice(MOUNT.length)
  if (rest === '' || rest === '/' || rest === '/index.html') return 'index'
  const target = resolve(normalize(join(DIST_ROOT, rest)))
  if (target === DIST_INDEX) return 'index'
  if (!target.startsWith(DIST_ROOT + sep)) return undefined
  return target
}

/** Query parameter Connection uses to exchange its launch token for the session cookie. */
const TOKEN_QUERY = 'token'

/** The response operations `authorizeIndex` may own (dsh-client-connection's ConnectionIndexResponse). */
export interface IndexAuthResponse {
  writeHead(status: number, headers?: Readonly<Record<string, string>>): unknown
  end(body?: string): unknown
}

/** What `authorizeIndex` wrote while refusing an index request. */
interface IndexAuthWrites {
  status: number
  headers?: Readonly<Record<string, string>>
  body?: string
}

/**
 * Hand `authorizeIndex` a response that records instead of writing, so M3E can
 * decide what an unauthenticated browser sees before anything reaches the socket.
 * @returns the substitute response and a reader for what was written to it.
 */
function captureIndexAuthResponse(): { response: IndexAuthResponse; written: () => IndexAuthWrites | undefined } {
  let written: IndexAuthWrites | undefined
  const response: IndexAuthResponse = {
    writeHead(status, headers) {
      written = { status, headers }
      return response
    },
    end(body) {
      written = written === undefined ? { status: 401, body } : { ...written, body }
      return response
    },
  }
  return { response, written: () => written }
}

/**
 * Tell an unauthenticated request from a token exchange or a stale token, which
 * stay Connection's business.
 * @param url - raw request target.
 * @returns true when the `token` query parameter is present.
 */
function hasTokenQuery(url: string | undefined): boolean {
  return new URL(url ?? '/', 'http://dsh.invalid').searchParams.getAll(TOKEN_QUERY).length > 0
}

/**
 * Response headers for the M3E explanation page. `no-store` keeps a shared cache
 * from holding a refusal, and the CSP admits only the page's own inline style.
 */
export const UNAUTHORIZED_HEADERS: Readonly<Record<string, string>> = {
  'content-type': HTML_MIME,
  'cache-control': 'no-store',
  // The page language follows the request's Accept-Language.
  vary: 'accept-language',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy':
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
}

/** The explanation page in each language M3E supports. Values may hold `<code>`; nothing comes from the request. */
const UNAUTHORIZED_TEXT = {
  ja: {
    title: 'ログインの情報を確かめられませんでした',
    cause: 'iPhone の Safari では、裏で閉じられたタブに戻ったときに、ログインの情報が送られないことがあります。このページを再読み込みしても直りません。',
    action: 'アドレスバーの URL をタップし、そのままキーボードの「開く」を押してください。',
    otherwise: 'それでも開けないときは、ログインの期限が切れたか、ログインしたときと違うアドレスで開いています。<code>dsh web</code> が表示した URL を開き直してください。',
  },
  en: {
    title: 'Could not verify your sign-in',
    cause: 'In Safari on iPhone, a tab that was closed in the background may not send your sign-in information when you return to it. Reloading this page does not fix it.',
    action: 'Tap the URL in the address bar, then tap “Go” on the keyboard.',
    otherwise: 'If it still does not open, your sign-in has expired or you opened a different address from the one you signed in with. Open the URL printed by <code>dsh web</code> again.',
  },
  zh: {
    title: '无法确认登录信息',
    cause: '在 iPhone 的 Safari 中，返回在后台被关闭的标签页时，可能不会发送登录信息。重新加载此页面也无法解决。',
    action: '请点击地址栏中的 URL，然后直接点击键盘上的“前往”。',
    otherwise: '如果仍然无法打开，说明登录已过期，或者打开的地址与登录时不同。请重新打开 <code>dsh web</code> 显示的 URL。',
  },
} as const satisfies Record<Locale, Record<'title' | 'cause' | 'action' | 'otherwise', string>>

/**
 * The browser languages of an `Accept-Language` header, most preferred first.
 * Ranges with `q=0` and the `*` wildcard name no language and are dropped.
 */
export function acceptedLanguages(header: string | undefined): string[] {
  return (header ?? '').split(',').flatMap((part, index) => {
    const [tag = '', ...params] = part.trim().split(';')
    const q = params.map(param => /^\s*q\s*=\s*([0-9.]+)\s*$/iu.exec(param)?.[1]).find(found => found !== undefined)
    const weight = q === undefined ? 1 : Number(q)
    return tag.trim() && tag.trim() !== '*' && weight > 0 ? [{ tag: tag.trim(), weight, index }] : []
  }).sort((left, right) => right.weight - left.weight || left.index - right.index).map(({ tag }) => tag)
}

/**
 * The fixed page M3E answers with when the browser holds no valid session and
 * the request carries no token. It reads in dark mode too and embeds nothing
 * from the request, so no URL, cookie or header can leak into it. The language
 * comes from `Accept-Language` the way the M3E page reads the browser language
 * (docs/design/11-i18n.md): DSH's own language setting is not readable before
 * sign-in.
 *
 * It offers no reload. In a tab Safari restored, every reload and every
 * navigation the page starts still goes out without the `SameSite=Strict`
 * cookie (WebKit bug 200345); only a URL committed from the address bar sends
 * it again. So the page names that one action instead of a button that fails.
 * @param locale - the page language.
 * @returns the complete HTML document.
 */
export function unauthorizedPage(locale: Locale): string {
  const text = UNAUTHORIZED_TEXT[locale]
  return `<!doctype html>
<html lang="${documentLanguage(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${text.title}</title>
<style>
:root { color-scheme: light dark; }
body { margin: 0; padding: 1.5rem; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; line-height: 1.75; }
main { max-width: 36rem; margin: 0 auto; }
h1 { font-size: 1.25rem; line-height: 1.5; margin: 0 0 1rem; }
p { margin: 0.75rem 0; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
</style>
</head>
<body>
<main>
<h1>${text.title}</h1>
<p>${text.cause}</p>
<p><strong>${text.action}</strong></p>
<p>${text.otherwise}</p>
</main>
</body>
</html>
`
}

export function apply(ctx: Context): void {
  const renderIndex = async () =>
    prepareM3eIndex(ctx.webServer.renderIndex(await readFile(DIST_INDEX, 'utf8')))

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      res.end()
      return
    }
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
    const target = resolveTarget(pathname)
    if (target === undefined) {
      res.writeHead(403)
      res.end()
      return
    }
    try {
      if (target === 'index') {
        const auth = captureIndexAuthResponse()
        if (!ctx.connection.authorizeIndex(req, auth.response)) {
          const written = auth.written()
          if (written === undefined) {
            // Connection owns the response whenever it returns false; answer with
            // the stock refusal rather than leaving the socket without a reply.
            res.writeHead(401, { 'cache-control': 'no-store' })
            res.end()
            return
          }
          if (written.status === 401 && !hasTokenQuery(req.url)) {
            res.writeHead(401, UNAUTHORIZED_HEADERS)
            res.end(req.method === 'HEAD' ? undefined : unauthorizedPage(requestedLocale({ languages: acceptedLanguages(req.headers['accept-language']) })))
            return
          }
          // A token exchange, a stale token and any other refusal keep the
          // decision Connection made, byte for byte.
          res.writeHead(written.status, written.headers)
          res.end(written.body)
          return
        }
        const body = await renderIndex()
        res.writeHead(200, {
          'content-type': HTML_MIME,
          'cache-control': 'no-store',
          // Approval controls must not be embedded, even by a same-site origin.
          'content-security-policy': "frame-ancestors 'none'",
          'x-frame-options': 'DENY',
        })
        res.end(body)
        return
      }
      const body = await readFile(target)
      const immutable = target.startsWith(join(DIST_ROOT, 'assets') + sep)
      res.writeHead(200, {
        'content-type': MIME[extname(target)] ?? 'application/octet-stream',
        'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      })
      res.end(body)
    } catch (error) {
      if (!MISS_CODES.has((error as NodeJS.ErrnoException).code ?? '')) throw error
      res.writeHead(404)
      res.end()
    }
  }

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: MOUNT, handler: handle }), 'webui-m3e: /m3e route')
  ctx.effect(() => ctx.webServer.tapIndex(injectUiChoice), 'webui-m3e: UI choice script')
}
