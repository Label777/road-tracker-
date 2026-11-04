// Время поездки: паузы, разбиение по дням (полночь), календарные интервалы.
// Все даты — миллисекунды Unix (number). Календарные расчёты — в часовом поясе,
// переданном явно (по умолчанию — пояс устройства), через Intl.

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

/** @typedef {{start: number, end: number}} Interval */

/** Длина объединения интервалов внутри [lo, hi) — перекрытия не считаются дважды. */
export function mergedLength(intervals, lo, hi) {
  const clamped = intervals
    .map((i) => ({ start: Math.max(i.start, lo), end: Math.min(i.end, hi) }))
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);
  let total = 0;
  let cur = null;
  for (const i of clamped) {
    if (cur && i.start <= cur.end) cur.end = Math.max(cur.end, i.end);
    else {
      if (cur) total += cur.end - cur.start;
      cur = { ...i };
    }
  }
  if (cur) total += cur.end - cur.start;
  return total;
}

/** Активная продолжительность (мс): [start, end] минус паузы. */
export function activeDuration(start, end, pauses = []) {
  if (!(end > start)) return 0;
  return Math.max(0, end - start - mergedLength(pauses, start, end));
}

// ---------------------------------------------------------------- часовые пояса

const partsFormatters = new Map();
function partsFormatter(timeZone) {
  let f = partsFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short',
    });
    partsFormatters.set(timeZone, f);
  }
  return f;
}

// Пояс устройства перечитывается не чаще раза в 30 с: запрос к Intl дорогой, а вызовов — тысячи на экран.
let tzCache = null;
let tzCheckedAt = -Infinity;
export const deviceTimeZone = () => {
  const now = Date.now();
  if (now - tzCheckedAt > 30_000) {
    tzCache = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    tzCheckedAt = now;
  }
  return tzCache;
};

const WEEKDAYS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
// Результаты разбора даты кэшируются: аналитика многократно спрашивает одни и те же полночи.
const partsCache = new Map();
const PARTS_LIMIT = 20_000;

/** Компоненты даты в часовом поясе: {year, month(1-12), day, hour, minute, second, weekday(1=Пн…7=Вс)}. */
export function zonedParts(ms, timeZone = deviceTimeZone()) {
  const key = `${timeZone}|${ms}`;
  const hit = partsCache.get(key);
  if (hit) return { ...hit };
  const p = {};
  for (const { type, value } of partsFormatter(timeZone).formatToParts(new Date(ms))) p[type] = value;
  const out = {
    year: +p.year, month: +p.month, day: +p.day,
    hour: +p.hour, minute: +p.minute, second: +p.second, weekday: WEEKDAYS[p.weekday],
  };
  if (partsCache.size >= PARTS_LIMIT) partsCache.clear();
  partsCache.set(key, out);
  return { ...out };
}

/** Смещение пояса относительно UTC в момент ms (мс). */
function offsetAt(ms, timeZone) {
  const p = zonedParts(ms, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/** Момент времени для «настенного» времени в поясе (учитывает переход на летнее время). */
export function zonedTime(year, month, day, hour = 0, minute = 0, timeZone = deviceTimeZone()) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let ms = guess - offsetAt(guess, timeZone);
  ms = guess - offsetAt(ms, timeZone); // вторая итерация — на случай перехода часов
  return ms;
}

export function startOfDay(ms, timeZone = deviceTimeZone()) {
  const p = zonedParts(ms, timeZone);
  return zonedTime(p.year, p.month, p.day, 0, 0, timeZone);
}

export function addDays(dayStart, n, timeZone = deviceTimeZone()) {
  const p = zonedParts(dayStart + 12 * HOUR, timeZone); // полдень — устойчиво к DST
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + n));
  return zonedTime(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 0, 0, timeZone);
}

export const isWeekend = (ms, timeZone = deviceTimeZone()) => zonedParts(ms, timeZone).weekday >= 6;

/**
 * Интервал периода, содержащего момент: 'day' | 'week' (с понедельника) | 'month' | 'year'.
 * @returns {Interval}
 */
export function periodInterval(unit, ms, timeZone = deviceTimeZone()) {
  const p = zonedParts(ms, timeZone);
  switch (unit) {
    case 'day': {
      const start = zonedTime(p.year, p.month, p.day, 0, 0, timeZone);
      return { start, end: addDays(start, 1, timeZone) };
    }
    case 'week': {
      const start = addDays(zonedTime(p.year, p.month, p.day, 0, 0, timeZone), -(p.weekday - 1), timeZone);
      return { start, end: addDays(start, 7, timeZone) };
    }
    case 'month': {
      const next = p.month === 12 ? [p.year + 1, 1] : [p.year, p.month + 1];
      return { start: zonedTime(p.year, p.month, 1, 0, 0, timeZone), end: zonedTime(next[0], next[1], 1, 0, 0, timeZone) };
    }
    case 'year':
      return { start: zonedTime(p.year, 1, 1, 0, 0, timeZone), end: zonedTime(p.year + 1, 1, 1, 0, 0, timeZone) };
    default:
      throw new Error(`unknown unit ${unit}`);
  }
}

export function addMonths(ms, n, timeZone = deviceTimeZone()) {
  const p = zonedParts(ms, timeZone);
  const d = new Date(Date.UTC(p.year, p.month - 1 + n, 1));
  return zonedTime(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, timeZone);
}

/** Разбиение интервала по полуночам: [{day, ms}]. */
export function splitByDay(start, end, timeZone = deviceTimeZone()) {
  const result = [];
  let cursor = start;
  while (cursor < end) {
    const day = startOfDay(cursor, timeZone);
    const next = addDays(day, 1, timeZone);
    const sliceEnd = Math.min(next, end);
    result.push({ day, ms: sliceEnd - cursor });
    cursor = sliceEnd;
  }
  return result;
}

/** «1 ч 05 мин», «45 мин». */
export function formatDuration(ms) {
  const total = Math.floor(Math.round(ms / 1000) / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h} ч ${String(m).padStart(2, '0')} мин` : `${m} мин`;
}

export const formatHours = (ms) => `${(ms / HOUR).toFixed(1).replace('.', ',')} ч`;
