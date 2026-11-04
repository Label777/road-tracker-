// Карта (Leaflet + OpenStreetMap), загружается только когда нужна.
// Leaflet лежит в самом сайте (vendor/) и работает офлайн; тайлы уже виденных мест
// service worker хранит в кэше. Без сети и кэша формы работают — координаты вводятся вручную.

const LEAFLET = new URL('../../vendor/leaflet/leaflet', import.meta.url).href;
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
let loading = null;

function loadLeaflet() {
  if (globalThis.L) return Promise.resolve(globalThis.L);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = `${LEAFLET}.css`;
      document.head.append(css);
      const js = document.createElement('script');
      js.src = `${LEAFLET}.js`;
      js.onload = () => resolve(globalThis.L);
      js.onerror = () => { loading = null; reject(new Error('Не удалось загрузить карту')); };
      document.head.append(js);
    });
  }
  return loading;
}

const ACCENT = '#2ef07a';

/**
 * @param {HTMLElement} el
 * @param {{track?: {lat:number, lon:number}[], center?: {lat:number, lon:number}, radius?: number,
 *          onMove?: (c: {lat:number, lon:number}) => void}} opts
 * @returns {Promise<{setCenter: (c: {lat:number, lon:number}) => void, setRadius: (r:number) => void} | null>}
 */
export async function mapView(el, opts) {
  let L;
  try {
    L = await loadLeaflet();
  } catch (e) {
    el.innerHTML = `<p class="empty">${e.message}</p>`;
    return null;
  }
  if (!el.isConnected) return null;
  const map = L.map(el, { zoomControl: true, attributionControl: true });
  L.tileLayer(TILE_URL, {
    maxZoom: 19, crossOrigin: true,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  if (opts.track?.length) {
    const line = L.polyline(opts.track.map((p) => [p.lat, p.lon]), { color: ACCENT, weight: 4 }).addTo(map);
    L.circleMarker(line.getLatLngs()[0], { radius: 6, color: ACCENT, fillOpacity: 1 }).addTo(map);
    L.circleMarker(line.getLatLngs().at(-1), { radius: 6, color: '#fff', fillOpacity: 1 }).addTo(map);
    map.fitBounds(line.getBounds(), { padding: [20, 20] });
    return null;
  }

  // Выбор точки: метка в центре, двигается карта
  const center = opts.center ?? { lat: 50.4501, lon: 30.5234 };
  map.setView([center.lat, center.lon], 16);
  const circle = L.circle([center.lat, center.lon], { radius: opts.radius ?? 150, color: ACCENT, weight: 1.5, fillOpacity: 0.15 }).addTo(map);
  const pin = document.createElement('div');
  pin.className = 'map-pin';
  el.append(pin);
  map.on('move', () => circle.setLatLng(map.getCenter()));
  map.on('moveend', () => {
    const c = map.getCenter();
    opts.onMove?.({ lat: c.lat, lon: c.lng });
  });
  return {
    setCenter: (c) => map.setView([c.lat, c.lon], Math.max(map.getZoom(), 16)),
    setRadius: (r) => circle.setRadius(r),
  };
}

/**
 * Живая карта активной поездки. Создаётся один раз на поездку и переносится между
 * перерисовками экрана (Leaflet не пересоздаётся — карта не мигает и не сбрасывает масштаб).
 */
export class LiveMap {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'live-map';
    this.map = null;
    this.line = null;
    this.dot = null;
    this.places = null;
    this.follow = true;
    this.ready = null;
  }

  attach(parent) {
    parent.append(this.el);
    if (!this.ready) this.ready = this.#init();
    else this.ready.then(() => this.map?.invalidateSize());
    return this.ready;
  }

  async #init() {
    let L;
    try {
      L = await loadLeaflet();
    } catch (e) {
      this.el.innerHTML = `<div class="no-gps"><p>${e.message}</p></div>`;
      return;
    }
    this.L = L;
    this.map = L.map(this.el, { zoomControl: false, attributionControl: true }).setView([50.4501, 30.5234], 13);
    L.tileLayer(TILE_URL, {
      maxZoom: 19, crossOrigin: true, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
    }).addTo(this.map);
    this.line = L.polyline([], { color: ACCENT, weight: 5, opacity: 0.95, lineCap: 'round' }).addTo(this.map);
    this.dot = L.circleMarker([0, 0], { radius: 8, color: '#0b0d10', weight: 3, fillColor: ACCENT, fillOpacity: 1 });
    this.map.on('dragstart', () => { this.follow = false; });
  }

  /** @param {{lat:number, lon:number}[]} track @param {{lat:number, lon:number, radius:number}[]} places */
  async update(track, places = []) {
    await this.ready;
    if (!this.map) return;
    const L = this.L;
    if (!this.places) {
      this.places = places.map((p) => L.circle([p.lat, p.lon], { radius: p.radius, color: '#8d949e', weight: 1, fillOpacity: 0.06 }).addTo(this.map));
    }
    const pts = track.map((p) => [p.lat, p.lon]);
    this.line.setLatLngs(pts);
    if (!pts.length) return;
    const last = pts.at(-1);
    this.dot.setLatLng(last).addTo(this.map);
    if (this.follow) {
      if (pts.length > 1 && !this.fitted) { this.map.fitBounds(this.line.getBounds(), { padding: [40, 40], maxZoom: 16 }); this.fitted = true; }
      else this.map.panTo(last, { animate: true });
    }
  }

  recenter() {
    this.follow = true;
    this.fitted = false;
  }
}

/** Поиск адреса (OpenStreetMap Nominatim). Возвращает {lat, lon, name, address} или null. */
export async function geocode(query, near) {
  const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: '1', 'accept-language': 'ru,uk' });
  if (near) params.set('viewbox', `${near.lon - 0.5},${near.lat + 0.5},${near.lon + 0.5},${near.lat - 0.5}`);
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
  if (!res.ok) throw new Error('Поиск адреса недоступен');
  const [hit] = await res.json();
  return hit ? { lat: +hit.lat, lon: +hit.lon, name: hit.name || query, address: hit.display_name } : null;
}
