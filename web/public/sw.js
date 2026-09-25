import { cacheFirst, isCacheableRequest, removeOldCaches } from './sw-cache.js'

self.addEventListener('install', (event) => {
  event.waitUntil(removeOldCaches(caches).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(removeOldCaches(caches).then(() => self.clients.claim()))
})

self.addEventListener('fetch', (event) => {
  if (!isCacheableRequest(event.request, self.location.origin)) return
  event.respondWith(cacheFirst(event.request, caches, (request) => fetch(request)))
})
