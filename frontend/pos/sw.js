// Service worker de la caja: permite abrir /pos sin internet.
// Red primero (para recibir versiones nuevas) y caché como respaldo. Las
// llamadas al API nunca se cachean aquí: la caja maneja sus datos en IndexedDB.
const CACHE = 'katu-pos-v2';
const BASE = ['/pos/', '/pos/index.html', '/pos/caja.html', '/pos/visor.html', '/pos/pos.css', '/pos/base.js', '/pos/equipos.js', '/pos/caja.js', '/pos/autopago.html', '/pos/autopago.js', '/pos/autopago.css', '/assets/js/motor.js', '/assets/js/bascula.js', '/assets/img/logo.png', '/assets/img/favicon.ico',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Sora:wght@500;600;700;800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css'];
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(BASE.map(u => c.add(u))))); });
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/api/') || !/^https?:$/.test(u.protocol)) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    try {
      const r = await fetch(e.request, { signal: AbortSignal.timeout(6000) });
      if (r.ok || r.type === 'opaque') c.put(e.request, r.clone());
      return r;
    } catch (err) {
      const g = await c.match(e.request, { ignoreSearch: true });
      if (g) return g;
      throw err;
    }
  })());
});
