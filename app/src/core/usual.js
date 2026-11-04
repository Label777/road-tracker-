// «Обычная поездка»: типичная поездка в направлении по последним записям —
// чаще всего повторяющийся набор этапов и цена, обычное время выезда и длительность.
// Только реальные данные: без истории в этом направлении плана нет.
import { zonedParts, zonedTime, startOfDay, deviceTimeZone, MINUTE } from './time.js';
import { segmentSignature, tripCost } from './analytics.js';

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/**
 * @param {Array} trips сводки поездок (Store.summary), новые первыми
 * @param {string} direction
 * @returns {null | {direction, startMinute, durationMs, cost, segments, extraCost, routeId, templateId, basedOn}}
 */
export function usualPlan(trips, direction, { tz = deviceTimeZone(), recent = 20 } = {}) {
  const pool = trips.filter((t) => t.direction === direction).slice(0, recent);
  if (!pool.length) return null;
  const groups = new Map();
  for (const t of pool) {
    const key = `${t.routeId ?? ''}|${segmentSignature(t)}|${tripCost(t)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  // Самая частая группа; при равенстве — та, что встречалась последней (Map хранит порядок появления).
  let best = null;
  for (const g of groups.values()) if (!best || g.length > best.length) best = g;
  const sample = best.length >= 2 ? best : pool;
  const template = best[0];
  const minuteOfDay = (ms) => { const p = zonedParts(ms, tz); return p.hour * 60 + p.minute; };
  return {
    direction,
    startMinute: median(sample.map((t) => minuteOfDay(t.startedAt))),
    durationMs: Math.max(5 * MINUTE, Math.round(median(sample.map((t) => t.activeMs)) / MINUTE) * MINUTE),
    cost: tripCost(template),
    segments: template.segments,
    extraCost: template.extraCost || 0,
    routeId: template.routeId ?? null,
    templateId: template.id,
    basedOn: best.length,
  };
}

/**
 * Когда записать обычную поездку сегодня. Если обычное время ещё не наступило
 * (или поездка не успела бы закончиться), поездка заканчивается «сейчас».
 */
export function placeToday(plan, now, tz = deviceTimeZone()) {
  const p = zonedParts(now, tz);
  let start = zonedTime(p.year, p.month, p.day, Math.floor(plan.startMinute / 60), plan.startMinute % 60, tz);
  if (start + plan.durationMs > now) start = now - plan.durationMs;
  return { start, end: start + plan.durationMs };
}

/** Есть ли сегодня уже поездка в этом направлении. */
export const loggedToday = (trips, direction, now, tz = deviceTimeZone()) => {
  const day = startOfDay(now, tz);
  return trips.some((t) => t.direction === direction && startOfDay(t.startedAt, tz) === day);
};
