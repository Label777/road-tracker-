// Service worker: сайт открывается мгновенно и без интернета.
// Оболочка (свои файлы) — «сначала кэш»: каждая версия сайта целиком лежит в своём кэше,
// поэтому файлы разных версий никогда не смешиваются. Новая версия скачивается в фоне,
// и страница предлагает обновиться (сообщение 'skip-waiting').
// Тайлы карты — отдельный кэш с ограничением размера: карта знакомых мест открывается офлайн.
// VERSION и SHELL обновляет scripts/build-sw.sh (версия = хеш содержимого файлов).
const VERSION = 'rt-52228cba63';
const TILES = 'rt-tiles';
const TILE_LIMIT = 600;
const TILE_HOST = 'tile.openstreetmap.org';
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
    'src/core/backup.js',
    'src/core/editing.js',
    'src/core/geo.js',
    'src/core/insights.js',
    'src/core/inspections.js',
    'src/core/money.js',
    'src/core/past.js',
    'src/core/stale.js',
    'src/core/steps.js',
    'src/core/sync-policy.js',
    'src/core/time.js',
    'src/core/tracking.js',
    'src/core/usual.js',
    'src/data/db.js',
    'src/data/store.js',
    'src/data/sync.js',
    'src/ui/actions.js',
    'src/ui/backup.js',
    'src/ui/components.js',
    'src/ui/format.js',
    'src/ui/haptics.js',
    'src/ui/health.js',
    'src/ui/html.js',
    'src/ui/main.js',
    'src/ui/map.js',
    'src/ui/permissions.js',
    'src/ui/sheet.js',
    'src/ui/stale.js',
    'src/ui/step-sensor.js',
    'src/ui/suggest.js',
    'src/ui/tracker.js',
    'src/ui/views/analytics.js',
    'src/ui/views/dashboard.js',
    'src/ui/views/design.js',
    'src/ui/views/do.js',
    'src/ui/views/editor.js',
    'src/ui/views/history.js',
    'src/ui/views/past-trip.js',
    'src/ui/views/places.js',
    'src/ui/views/profile.js',
    'src/ui/views/quick-add.js',
    'src/ui/views/shortcuts.js',
    'src/ui/views/start-sheet.js',
    'src/ui/views/trip.js',
    'vendor/leaflet/images/layers-2x.png',
    'vendor/leaflet/images/layers.png',
    'vendor/leaflet/images/marker-icon-2x.png',
    'vendor/leaflet/images/marker-icon.png',
    'vendor/leaflet/images/marker-shadow.png',
    'vendor/leaflet/leaflet.css',
    'vendor/leaflet/leaflet.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // cache: 'reload' — мимо HTTP-кэша браузера, чтобы в новую версию не попали старые файлы
    await cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })));
    // Первая установка — сразу в работу; обновление ждёт согласия пользователя.
    if (!self.registration.active) await self.skipWaiting();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('rt-') && k !== VERSION && k !== TILES).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

let tilePuts = 0;
async function trimTiles(cache) {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - TILE_LIMIT))) await cache.delete(k);
}

async function tile(req) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    await cache.put(req, res.clone());
    if (++tilePuts % 25 === 0) trimTiles(cache);
  }
  return res;
}

async function shell(req) {
  const cache = await caches.open(VERSION);
  const key = req.mode === 'navigate' ? 'index.html' : req;
  const hit = await cache.match(key, { ignoreSearch: true });
  if (hit) return hit;
  // Файла нет в кэше (например, первая загрузка до установки) — из сети, с сохранением
  const res = await fetch(req);
  if (res.ok && req.mode !== 'navigate') cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith(TILE_HOST)) {
    event.respondWith(tile(req));
    return;
  }
  // Supabase, поиск адреса и прочие чужие запросы — напрямую в сеть
  if (url.origin !== self.location.origin) return;
  event.respondWith(shell(req));
});
