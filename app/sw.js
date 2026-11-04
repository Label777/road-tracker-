// Service worker: сайт открывается и работает без интернета.
// Стратегия — «сначала сеть, при её отсутствии — кэш» для своих файлов: после обновления
// сайта пользователь сразу получает новую версию, а без сети — последнюю сохранённую.
const VERSION = 'rt-v1';
const SHELL = [
    './',
    'index.html',
    'styles.css',
    'manifest.webmanifest',
    'icons/apple-touch-icon.png',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/icon-maskable-512.png',
    'icons/icon.svg',
    'src/config.js',
    'src/core/analytics.js',
    'src/core/editing.js',
    'src/core/geo.js',
    'src/core/inspections.js',
    'src/core/money.js',
    'src/core/sync-policy.js',
    'src/core/time.js',
    'src/core/tracking.js',
    'src/data/db.js',
    'src/data/store.js',
    'src/data/sync.js',
    'src/ui/components.js',
    'src/ui/format.js',
    'src/ui/haptics.js',
    'src/ui/html.js',
    'src/ui/main.js',
    'src/ui/map.js',
    'src/ui/permissions.js',
    'src/ui/sheet.js',
    'src/ui/suggest.js',
    'src/ui/tracker.js',
    'src/ui/views/analytics.js',
    'src/ui/views/dashboard.js',
    'src/ui/views/design.js',
    'src/ui/views/editor.js',
    'src/ui/views/history.js',
    'src/ui/views/places.js',
    'src/ui/views/profile.js',
    'src/ui/views/quick-add.js',
    'src/ui/views/trip.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Чужие запросы (Supabase, карты) — без вмешательства
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const fresh = await fetch(req);
      if (fresh.ok) cache.put(req, fresh.clone());
      return fresh;
    } catch {
      const cached = await cache.match(req, { ignoreSearch: true });
      if (cached) return cached;
      if (req.mode === 'navigate') return cache.match('./index.html');
      throw new Error('offline');
    }
  })());
});
