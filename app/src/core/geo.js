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

/**
 * Расстояние по каждому этапу: точки трека от начала этапа до его конца (или до now).
 * Точка на границе входит в оба этапа — между ними не теряется отрезок.
 * @returns {Map<string, number>} id этапа → метры (только для этапов с временем начала)
 */
export function segmentDistances(track, segments, now = Date.now()) {
  const out = new Map();
  const sorted = [...track].sort((a, b) => a.t - b.t);
  for (const seg of segments) {
    if (seg.started_at == null) continue;
    const end = seg.finished_at ?? now;
    const pts = sorted.filter((p) => p.t >= seg.started_at && p.t <= end);
    // последняя точка до начала этапа — чтобы считать от места пересадки
    const before = pts[0]?.t === seg.started_at ? null : sorted.filter((p) => p.t < seg.started_at).at(-1);
    out.set(seg.id, Math.round(trackDistance(before ? [before, ...pts] : pts)));
  }
  return out;
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

/**
 * Трек, разбитый на участки по этапам — для раскраски линии на карте цветом транспорта.
 * Точка смены этапа входит в оба участка, чтобы линия не рвалась. Точки вне этапов
 * (до первой отметки транспорта) — участок с type = null.
 * @returns {{type: string|null, points: Sample[]}[]}
 */
export function trackRuns(track, segments) {
  const sorted = [...track].sort((a, b) => a.t - b.t);
  const timed = segments.filter((s) => s.started_at != null).sort((a, b) => a.started_at - b.started_at);
  const typeAt = (t) => {
    let type = null;
    for (const s of timed) if (t >= s.started_at && (s.finished_at == null || t <= s.finished_at)) type = s.transport_type;
    return type;
  };
  const runs = [];
  for (const p of sorted) {
    const type = typeAt(p.t);
    const last = runs.at(-1);
    if (last && last.type === type) last.points.push(p);
    else runs.push({ type, points: last ? [last.points.at(-1), p] : [p] });
  }
  return runs;
}
