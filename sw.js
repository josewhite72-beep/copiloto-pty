// Service Worker – Copiloto de Ruta
// App: red primero (con límite de 3 s) para recibir actualizaciones; si no hay señal, usa la caché.
// Mapa (OpenStreetMap): se reusa lo ya visto; no se descargan zonas completas.

const APP_CACHE = 'copiloto-app-v11';
const TILE_CACHE = 'copiloto-osm-v1';
const TILE_MAX_DIAS = 7; // las reglas de OpenStreetMap piden reusar lo ya visto al menos 7 días

const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './lib/leaflet.js',
  './lib/leaflet.css',
  './lib/images/marker-icon.png',
  './lib/images/marker-icon-2x.png',
  './lib/images/marker-shadow.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-48.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP_CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== APP_CACHE && k !== TILE_CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// Mapa: reusa lo ya visto (hasta 7 días); luego lo pide de nuevo. Sin señal, sirve lo guardado.
async function tileCacheFirst(req) {
  const cache = await caches.open(TILE_CACHE);
  const guardado = await cache.match(req);
  const fecha = guardado && Date.parse(guardado.headers.get('date') || '');
  const fresco = guardado && fecha && (Date.now() - fecha) < TILE_MAX_DIAS * 864e5;
  if (fresco) return guardado;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
  } catch (err) {
    return guardado || new Response('', { status: 504, statusText: 'Offline' });
  }
}

async function redPrimero(req) {
  const cache = await caches.open(APP_CACHE);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))
    ]);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    return (await cache.match(req, { ignoreSearch: true })) ||
           (req.mode === 'navigate' ? cache.match('./index.html') : Response.error());
  }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'tile.openstreetmap.org') {
    e.respondWith(tileCacheFirst(req));
  } else if (url.origin === self.location.origin) {
    e.respondWith(redPrimero(req));
  }
});
