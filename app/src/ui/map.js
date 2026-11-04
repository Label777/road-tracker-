// Карта (Leaflet + OpenStreetMap), загружается только когда нужна.
// Без сети карта не покажется — формы при этом работают (координаты вводятся вручную).

const LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet';
let loading = null;

function loadLeaflet() {
  if (globalThis.L) return Promise.resolve(globalThis.L);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = `${LEAFLET}.css`;
      css.crossOrigin = '';
      document.head.append(css);
      const js = document.createElement('script');
      js.src = `${LEAFLET}.js`;
      js.crossOrigin = '';
      js.onload = () => resolve(globalThis.L);
      js.onerror = () => { loading = null; reject(new Error('Карта недоступна без интернета')); };
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
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
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

/** Поиск адреса (OpenStreetMap Nominatim). Возвращает {lat, lon, name, address} или null. */
export async function geocode(query, near) {
  const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: '1', 'accept-language': 'ru,uk' });
  if (near) params.set('viewbox', `${near.lon - 0.5},${near.lat + 0.5},${near.lon + 0.5},${near.lat - 0.5}`);
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
  if (!res.ok) throw new Error('Поиск адреса недоступен');
  const [hit] = await res.json();
  return hit ? { lat: +hit.lat, lon: +hit.lon, name: hit.name || query, address: hit.display_name } : null;
}
