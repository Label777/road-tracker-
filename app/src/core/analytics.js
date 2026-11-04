// Финансовая аналитика, прогноз, калькулятор экономии.
import { divideMoney, sumMoney } from './money.js';
import { addDays, deviceTimeZone, isWeekend, periodInterval, startOfDay, addMonths, zonedParts } from './time.js';

/**
 * Плоская поездка для аналитики.
 * @typedef {{
 *   id: string, direction: 'to_work'|'to_home'|'other', startedAt: number, finishedAt: number,
 *   activeMs: number, timeZone?: string,
 *   segments: {transport: string, cost: number, number?: string|null}[],
 *   extraCost: number, controllers: number, routeId?: string|null
 * }} TripSummary
 */

export const tripCost = (t) => sumMoney(t.segments.map((s) => s.cost)) + (t.extraCost || 0);
/** Пересадки: сегменты транспорта, кроме первого; пешие не считаются. */
export const tripTransfers = (t) => Math.max(0, t.segments.filter((s) => s.transport !== 'walk').length - 1);

export function emptyTotals() {
  return { trips: 0, activeMs: 0, cost: 0, transfers: 0, transports: new Set(), controllers: 0 };
}

export function totalsOf(trips) {
  const t = emptyTotals();
  for (const trip of trips) {
    t.trips += 1;
    t.activeMs += trip.activeMs;
    t.cost += tripCost(trip);
    t.transfers += tripTransfers(trip);
    for (const s of trip.segments) t.transports.add(s.transport);
    t.controllers += trip.controllers || 0;
  }
  return t;
}

export const averageTripMs = (t) => (t.trips ? t.activeMs / t.trips : null);
export const averageTripCost = (t) => divideMoney(t.cost, t.trips);

export const inInterval = (trips, { start, end }) => trips.filter((t) => t.startedAt >= start && t.startedAt < end);

export function costByDirection(trips) {
  const r = {};
  for (const t of trips) r[t.direction] = (r[t.direction] || 0) + tripCost(t);
  return r;
}

export function costByTransport(trips) {
  const r = {};
  for (const t of trips) {
    for (const s of t.segments) r[s.transport] = (r[s.transport] || 0) + s.cost;
    if (t.extraCost > 0) r.other = (r.other || 0) + t.extraCost;
  }
  return r;
}

/** Итоги по дням: Map(начало дня → totals). */
export function dailyTotals(trips, tz = deviceTimeZone()) {
  const groups = new Map();
  for (const t of trips) {
    const day = startOfDay(t.startedAt, tz);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(t);
  }
  const out = new Map();
  for (const [day, list] of groups) out.set(day, totalsOf(list));
  return out;
}

/** Ряд для графика: каждый день интервала, пустые дни — нули. */
export function dailySeries(trips, interval, tz = deviceTimeZone()) {
  const daily = dailyTotals(inInterval(trips, interval), tz);
  const out = [];
  for (let d = startOfDay(interval.start, tz); d < interval.end; d = addDays(d, 1, tz)) {
    const t = daily.get(d);
    out.push({ day: d, cost: t ? t.cost : 0, activeMs: t ? t.activeMs : 0 });
  }
  return out;
}

/** Средняя стоимость дня с поездками. */
export function averageCommuteDayCost(trips, tz = deviceTimeZone()) {
  const days = new Set(trips.map((t) => startOfDay(t.startedAt, tz)));
  return divideMoney(totalsOf(trips).cost, days.size);
}

/**
 * Сравнение «месяц к дате»: с 1-го числа по сегодня против тех же дней прошлого месяца.
 * Иначе в начале месяца неполный месяц сравнивается с полным (−80 % на 4-е число).
 */
export function monthToDateComparison(trips, now, tz = deviceTimeZone()) {
  const cur = periodInterval('month', now, tz);
  const dayIndex = zonedParts(now, tz).day;
  const prevStart = addMonths(now, -1, tz);
  const prevMonth = periodInterval('month', prevStart, tz);
  const prevEnd = Math.min(addDays(prevMonth.start, dayIndex, tz), prevMonth.end);
  const current = totalsOf(inInterval(trips, { start: cur.start, end: addDays(startOfDay(now, tz), 1, tz) }));
  const previous = totalsOf(inInterval(trips, { start: prevMonth.start, end: prevEnd }));
  const previousFull = totalsOf(inInterval(trips, prevMonth));
  return {
    current, previous, previousFull,
    costChange: previous.cost > 0 ? (current.cost - previous.cost) / previous.cost : null,
  };
}

/**
 * Сравнение реальных маршрутов по истории: группировка по шаблону или по цепочке транспорта.
 * @param {(t: TripSummary) => {key: string, label: string}} keyOf
 */
export function routeStats(trips, keyOf) {
  const groups = new Map();
  for (const t of trips) {
    const { key, label } = keyOf(t);
    if (!groups.has(key)) groups.set(key, { key, label, trips: [] });
    groups.get(key).trips.push(t);
  }
  return [...groups.values()].map((g) => ({
    key: g.key, label: g.label, count: g.trips.length,
    avgMs: g.trips.reduce((a, t) => a + t.activeMs, 0) / g.trips.length,
    avgCost: Math.round(g.trips.reduce((a, t) => a + tripCost(t), 0) / g.trips.length),
  })).sort((a, b) => b.count - a.count);
}

export const segmentSignature = (t) => t.segments.filter((s) => s.transport !== 'walk')
  .map((s) => (s.number ? `${s.transport}:${s.number}` : s.transport)).join('>') || 'none';

export function monthComparison(trips, now, tz = deviceTimeZone()) {
  const cur = periodInterval('month', now, tz);
  const prev = periodInterval('month', addMonths(now, -1, tz), tz);
  const current = totalsOf(inInterval(trips, cur));
  const previous = totalsOf(inInterval(trips, prev));
  return {
    current,
    previous,
    costChange: previous.cost > 0 ? (current.cost - previous.cost) / previous.cost : null,
    timeChange: previous.activeMs > 0 ? (current.activeMs - previous.activeMs) / previous.activeMs : null,
  };
}

export function weekdaysBetween(start, end, tz = deviceTimeZone()) {
  let n = 0;
  for (let d = startOfDay(start, tz); d < end; d = addDays(d, 1, tz)) if (!isWeekend(d, tz)) n++;
  return n;
}

/**
 * Прогноз до конца месяца/года: потрачено + средний расход дня × доля будних дней с поездками × оставшиеся будни.
 * Статистика — за последние `lookbackDays`. null, если дней с поездками меньше `minDays`.
 */
export function forecast(trips, unit, now, { tz = deviceTimeZone(), lookbackDays = 56, minDays = 5 } = {}) {
  const period = periodInterval(unit, now, tz);
  const today = startOfDay(now, tz);
  const tomorrow = addDays(today, 1, tz);
  // Не считаем «днями без поездок» недели до первой записи: иначе прогноз занижен для новых пользователей.
  const firstTrip = trips.reduce((m, t) => Math.min(m, t.startedAt), Infinity);
  const lookStart = Math.max(addDays(today, -lookbackDays, tz), Number.isFinite(firstTrip) ? startOfDay(firstTrip, tz) : -Infinity);
  const history = inInterval(trips, { start: lookStart, end: tomorrow });
  const days = new Set(history.map((t) => startOfDay(t.startedAt, tz)));
  if (days.size < minDays) return null;
  const avg = divideMoney(totalsOf(history).cost, days.size);
  const observedWeekdays = weekdaysBetween(lookStart, tomorrow, tz);
  const weekdayCommute = [...days].filter((d) => !isWeekend(d, tz)).length;
  const rate = observedWeekdays ? Math.min(1, weekdayCommute / observedWeekdays) : 0;
  const spent = totalsOf(inInterval(trips, { start: period.start, end: Math.min(tomorrow, period.end) })).cost;
  const remaining = weekdaysBetween(tomorrow, period.end, tz);
  return {
    averagePerDay: avg,
    rate,
    projected: spent + Math.round(avg * rate * remaining),
    basedOnDays: days.size,
  };
}

/**
 * «Деньги против времени». a, b: {name, minutes, cost}.
 * verdict: 'identical' | 'dominates' | 'tradeoff'.
 */
export function compareRoutes(a, b) {
  const [cheap, pricey] = a.cost <= b.cost ? [a, b] : [b, a];
  const saved = pricey.cost - cheap.cost;
  const lost = cheap.minutes - pricey.minutes;
  if (saved === 0 && Math.abs(lost) < 1e-9) {
    return { verdict: 'identical', saved: 0, minutesLost: 0, perMinute: null, cheaper: cheap.name, winner: null };
  }
  if (lost <= 0) {
    return { verdict: 'dominates', saved, minutesLost: 0, perMinute: null, cheaper: cheap.name, winner: cheap.name };
  }
  if (saved === 0) {
    const fast = a.minutes <= b.minutes ? a : b;
    return { verdict: 'dominates', saved: 0, minutesLost: 0, perMinute: null, cheaper: cheap.name, winner: fast.name };
  }
  return {
    verdict: 'tradeoff', saved, minutesLost: lost, perMinute: Math.round(saved / lost), cheaper: cheap.name, winner: null,
  };
}

export const projectSavings = (r, trips) => ({ money: r.saved * trips, hours: (r.minutesLost * trips) / 60 });

/**
 * Бюджет месяца на дорогу: потрачено с 1-го числа, остаток, прогноз на конец месяца
 * и сколько можно тратить в каждый оставшийся будний день. budget — копейки.
 */
export function monthBudget(trips, budget, now, tz = deviceTimeZone()) {
  if (!(budget > 0)) return null;
  const month = periodInterval('month', now, tz);
  const tomorrow = addDays(startOfDay(now, tz), 1, tz);
  const spent = totalsOf(inInterval(trips, { start: month.start, end: tomorrow })).cost;
  const f = forecast(trips, 'month', now, { tz });
  const projected = f ? f.projected : null;
  const left = budget - spent;
  const days = weekdaysBetween(tomorrow, month.end, tz);
  let verdict = 'unknown';
  if (spent > budget) verdict = 'over';
  else if (projected != null) verdict = projected > budget ? 'risk' : 'within';
  return {
    budget, spent, left, share: spent / budget, projected,
    overBy: projected != null ? Math.max(0, projected - budget) : Math.max(0, spent - budget),
    perWeekday: left > 0 && days > 0 ? Math.floor(left / days) : null,
    weekdaysLeft: days,
    verdict,
  };
}

/**
 * Пешком и расстояние за период: метры пешком, шаги (и есть ли среди них оценки),
 * дни с ходьбой, расстояние всех поездок с GPS.
 */
export function movementTotals(trips) {
  let walkMeters = 0, steps = 0, estimated = false, walkTrips = 0, gpsMeters = 0, gpsTrips = 0;
  const days = new Set();
  for (const t of trips) {
    if (t.distance > 0) { gpsMeters += t.distance; gpsTrips++; }
    if (!t.walk) continue;
    walkTrips++;
    walkMeters += t.walk.meters || 0;
    if (t.walk.steps) {
      steps += t.walk.steps;
      if (t.walk.source !== 'sensor') estimated = true;
      days.add(new Date(t.startedAt).toDateString());
    }
  }
  return { walkMeters, steps, estimated, walkTrips, walkDays: days.size, gpsMeters, gpsTrips };
}
