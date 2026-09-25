// Only this application's caches may be removed, never the standard UI's.
export const CACHE_PREFIX = 'dsh-webui-m3e-static-'
export const CACHE_NAME = `${CACHE_PREFIX}v2`

// Vite's default hash is eight characters, which may themselves include '-'.
// A fixed length distinguishes the hash from hyphens in the original name.
const HASHED_FILE = /^(\/m3e\/(?:assets|fonts)\/(?:[^/]+\/)*)([^/]+)-[A-Za-z0-9_-]{8}\.(js|css|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf)$/
const FONT_EXTENSION = /^(?:woff2?|ttf|otf)$/
const pendingWrites = new Map()

function assetFamily(url) {
  const match = HASHED_FILE.exec(url.pathname)
  if (!match || url.search || !/^https?:$/.test(url.protocol)) return undefined
  const [, directory, name, extension] = match
  if (directory.startsWith('/m3e/fonts/') && !FONT_EXTENSION.test(extension)) return undefined
  return `${url.origin}${directory}${name}.${extension}`
}

/** Allow only local static files; document and API requests always pass through. */
export function isCacheableRequest(request, origin) {
  if (request.method !== 'GET' || request.mode === 'navigate' ||
      request.destination === 'document' || request.destination === 'iframe' ||
      request.headers.has('range')) return false
  try {
    const url = new URL(request.url)
    return url.origin === origin && assetFamily(url) !== undefined
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

function saveAndPrune(cache, request, response) {
  const family = assetFamily(new URL(request.url))
  if (family === undefined) return Promise.resolve()
  // Serialize each family so concurrent versions cannot delete one another.
  const write = (pendingWrites.get(family) ?? Promise.resolve()).then(async () => {
    await cache.put(request, response)
    const keys = await cache.keys()
    await Promise.all(keys.filter((key) => key.url !== request.url &&
      assetFamily(new URL(key.url)) === family).map((key) => cache.delete(key)))
  }).catch(() => {
    // A failed write must retain the previous version; cleanup is best effort.
  })
  pendingWrites.set(family, write)
  void write.then(() => {
    if (pendingWrites.get(family) === write) pendingWrites.delete(family)
  })
  return write
}

/** Return the response promptly and expose storage work for event.waitUntil(). */
export function cacheFirst(request, storage, fetcher) {
  let write = Promise.resolve()
  const response = (async () => {
    let cache
    try {
      cache = await storage.open(CACHE_NAME)
      const cached = await cache.match(request)
      if (cached && isCacheableResponse(request, cached)) return cached
    } catch {
      // Storage being unavailable must not prevent an online request.
    }
    const result = await fetcher(request)
    if (cache && isCacheableResponse(request, result)) {
      write = saveAndPrune(cache, request, result.clone())
    }
    return result
  })()
  return {
    response,
    cacheDone: response.then(() => write, () => {}),
  }
}
