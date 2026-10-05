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
 */
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { uiChoiceScript } from '../shared/ui-choice.ts'

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
        if (!ctx.connection.authorizeIndex(req, res)) return
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
