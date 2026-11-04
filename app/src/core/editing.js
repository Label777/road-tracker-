// Проверка поездки, фильтры истории, сетка календаря.
import { tripCost } from './analytics.js';
import { addDays, deviceTimeZone, periodInterval, zonedParts } from './time.js';

const TOLERANCE = 60_000;

/**
 * Проблемы поездки. Блокирующие запрещают сохранение, остальные — предупреждения.
 * @param {{start:number, end:number|null, segments:{start?:number|null, end?:number|null}[], now:number, maxHours?:number}} p
 */
export function validateTrip({ start, end, segments, now, maxHours = 6 }) {
  const issues = [];
  if (start > now + TOLERANCE) issues.push({ code: 'startInFuture', blocking: true });
  if (end != null) {
    if (end <= start) issues.push({ code: 'endBeforeStart', blocking: true });
    else if (end - start > maxHours * 3_600_000) issues.push({ code: 'tooLong', hours: maxHours, blocking: false });
  }
  let prevEnd = null;
  segments.forEach((s, index) => {
    const a = s.start ?? null, b = s.end ?? null;
    if (a != null && b != null && b < a) issues.push({ code: 'segmentEndBeforeStart', index, blocking: true });
    const lo = start - TOLERANCE, hi = (end ?? Infinity) + TOLERANCE;
    if ([a, b].some((v) => v != null && (v < lo || v > hi))) issues.push({ code: 'segmentOutsideTrip', index, blocking: false });
    if (prevEnd != null && a != null && a < prevEnd - TOLERANCE) issues.push({ code: 'segmentsOverlap', index, blocking: false });
    prevEnd = b ?? a ?? prevEnd;
  });
  return issues;
}

export function issueMessage(i) {
  switch (i.code) {
    case 'startInFuture': return 'Начало поездки в будущем.';
    case 'endBeforeStart': return 'Окончание должно быть позже начала.';
    case 'tooLong': return `Поездка дольше ${i.hours} ч — проверьте время.`;
    case 'segmentEndBeforeStart': return `Этап ${i.index + 1}: прибытие раньше отправления.`;
    case 'segmentOutsideTrip': return `Этап ${i.index + 1} выходит за время поездки.`;
    case 'segmentsOverlap': return `Этап ${i.index + 1} начинается раньше, чем закончился предыдущий.`;
    default: return i.code;
  }
}

export const emptyFilter = () => ({
  from: null, to: null, directions: [], transports: [], minCost: null, maxCost: null,
  controllers: 'any', routeId: null, routeNumber: '',
});

export function activeFilterCount(f) {
  return [
    f.from != null || f.to != null, f.directions.length > 0, f.transports.length > 0,
    f.minCost != null || f.maxCost != null, f.controllers !== 'any', f.routeId != null,
    f.routeNumber.trim() !== '',
  ].filter(Boolean).length;
}

/** @param {import('./analytics.js').TripSummary} t */
export function matchesFilter(f, t) {
  if (f.from != null && t.startedAt < f.from) return false;
  if (f.to != null && t.startedAt >= f.to) return false;
  if (f.directions.length && !f.directions.includes(t.direction)) return false;
  if (f.transports.length && !t.segments.some((s) => f.transports.includes(s.transport))) return false;
  const cost = tripCost(t);
  if (f.minCost != null && cost < f.minCost) return false;
  if (f.maxCost != null && cost > f.maxCost) return false;
  if (f.controllers === 'met' && !(t.controllers > 0)) return false;
  if (f.controllers === 'notMet' && t.controllers > 0) return false;
  if (f.routeId != null && t.routeId !== f.routeId) return false;
  const num = f.routeNumber.trim().toLowerCase();
  if (num && !t.segments.some((s) => (s.number || '').toLowerCase().includes(num))) return false;
  return true;
}

/** Сетка месяца: недели с понедельника, пустые ячейки — null. */
export function monthGrid(ms, tz = deviceTimeZone()) {
  const { start, end } = periodInterval('month', ms, tz);
  const leading = zonedParts(start, tz).weekday - 1;
  const cells = Array(leading).fill(null);
  for (let d = start; d < end; d = addDays(d, 1, tz)) cells.push(d);
  while (cells.length % 7) cells.push(null);
  return { start, end, cells };
}
