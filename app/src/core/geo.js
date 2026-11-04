// Гео-математика, фильтр GPS-трека, остановки, адаптивная частота.

const EARTH_RADIUS = 6_371_008.8;
const rad = (d) => (d * Math.PI) / 180;

/** Расстояние по формуле гаверсинусов, метры. */
export function distance(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * @typedef {{lat: number, lon: number, t: number, acc: number, speed?: number}} Sample
 * t — мс, acc — точность, м.
 */

export const TRACK_DEFAULTS = { maxAccuracy: 50, maxPlausibleSpeed: 70, minStep: 8 };

/** Отбрасывает неточные отметки и физически невозможные скачки (> 250 км/ч). */
export function filterTrack(samples, opts = TRACK_DEFAULTS) {
  const out = [];
  for (const s of [...samples].sort((a, b) => a.t - b.t)) {
    if (!(s.acc >= 0 && s.acc <= opts.maxAccuracy)) continue;
    const last = out[out.length - 1];
    if (last) {
      const dt = (s.t - last.t) / 1000;
      if (dt <= 0) continue;
      if (distance(last, s) / dt > opts.maxPlausibleSpeed) continue;
    }
    out.push(s);
  }
  return out;
}

/** Пройденное расстояние; шаги меньше шума GPS не накапливаются. */
export function trackDistance(samples, opts = TRACK_DEFAULTS) {
  const clean = filterTrack(samples, opts);
  if (!clean.length) return 0;
  let anchor = clean[0];
  let total = 0;
  for (const s of clean.slice(1)) {
    const d = distance(anchor, s);
    if (d >= Math.max(opts.minStep, (anchor.acc + s.acc) / 2)) {
      total += d;
      anchor = s;
    }
  }
  return total;
}

/** Остановки: точки в радиусе `radius` м дольше `minDuration` мс. */
export function detectStops(samples, radius = 40, minDuration = 90_000) {
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const stops = [];
  let i = 0;
  while (i < sorted.length) {
    const anchor = sorted[i];
    let j = i + 1;
    while (j < sorted.length && distance(anchor, sorted[j]) <= radius) j++;
    const last = sorted[j - 1];
    if (last.t - anchor.t >= minDuration) {
      const cluster = sorted.slice(i, j);
      stops.push({
        lat: cluster.reduce((a, s) => a + s.lat, 0) / cluster.length,
        lon: cluster.reduce((a, s) => a + s.lon, 0) / cluster.length,
        start: anchor.t,
        end: last.t,
      });
      i = j;
    } else i++;
  }
  return stops;
}

/**
 * Параметры Geolocation API под ситуацию. В браузере частоту задать нельзя,
 * поэтому экономия достигается прореживанием записи (minIntervalMs / minDistance).
 */
export function gpsPolicy({ speed = -1, lowBattery = false } = {}) {
  if (lowBattery) return { enableHighAccuracy: false, minIntervalMs: 30_000, minDistance: 100 };
  if (speed < 0) return { enableHighAccuracy: true, minIntervalMs: 5_000, minDistance: 25 };
  if (speed < 2.5) return { enableHighAccuracy: true, minIntervalMs: 5_000, minDistance: 15 };
  if (speed < 15) return { enableHighAccuracy: true, minIntervalMs: 5_000, minDistance: 40 };
  return { enableHighAccuracy: true, minIntervalMs: 10_000, minDistance: 100 };
}

/** Стоит ли записывать новую отметку с учётом политики. */
export function shouldRecord(last, next, policy) {
  if (!last) return true;
  return next.t - last.t >= policy.minIntervalMs || distance(last, next) >= policy.minDistance;
}
