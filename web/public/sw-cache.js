// Only this application's caches may be removed, never the standard UI's.
export const CACHE_PREFIX = 'dsh-webui-m3e-static-'
export const CACHE_NAME = `${CACHE_PREFIX}v1`

const HASHED_ASSET = /^\/m3e\/assets\/(?:[^/]+\/)*[^/]+-[A-Za-z0-9_-]{8,}\.(?:js|css|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf)$/
const FONT = /^\/m3e\/(?:assets|fonts)\/(?:[^/]+\/)*[^/]+\.(?:woff2?|ttf|otf)$/

/** Allow only local static files; document and API requests always pass through. */
export function isCacheableRequest(request, origin) {
  if (request.method !== 'GET' || request.mode === 'navigate' ||
      request.destination === 'document' || request.destination === 'iframe' ||
      request.headers.has('range')) return false
  try {
    const url = new URL(request.url)
    return url.origin === origin && /^https?:$/.test(url.protocol) &&
      !url.search && (HASHED_ASSET.test(url.pathname) || FONT.test(url.pathname))
  } catch {
    return false
  }
}

/** A successful asset URL must not smuggle an index/login page into the cache. */
export function isCacheableResponse(request, response) {
  if (response.status !== 200 || response.redirected ||
      /(?:no-store|private)/i.test(response.headers.get('cache-control') ?? '') ||
      response.headers.get('vary')?.split(',').some((value) => value.trim() === '*')) return false
  const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  const path = new URL(request.url).pathname.toLowerCase()
  if (path.endsWith('.js')) return type === 'text/javascript' || type === 'application/javascript'
  if (path.endsWith('.css')) return type === 'text/css'
  if (/\.(?:woff2?|ttf|otf)$/.test(path)) {
    return type.startsWith('font/') || ['application/font-woff', 'application/vnd.ms-opentype', 'application/octet-stream'].includes(type)
  }
  return type.startsWith('image/')
}

export async function removeOldCaches(storage) {
  const names = await storage.keys()
  await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
    .map((name) => storage.delete(name)))
}

export async function cacheFirst(request, storage, fetcher) {
  let cache
  try {
    cache = await storage.open(CACHE_NAME)
    const cached = await cache.match(request)
    if (cached && isCacheableResponse(request, cached)) return cached
  } catch {
    // Storage being unavailable must not prevent an online request.
  }
  const response = await fetcher(request)
  if (cache && isCacheableResponse(request, response)) {
    try {
      await cache.put(request, response.clone())
    } catch {
      // Quota limits must not discard a successful network response.
    }
  }
  return response
}
