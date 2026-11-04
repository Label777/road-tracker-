// Выводы словами над графиками аналитики: до трёх коротких фраз, у каждой есть число и период.
// Вывод появляется только когда для него достаточно данных; выдуманных чисел нет.
import { formatMoney } from './money.js';
import { formatDuration, periodInterval, startOfDay, addDays, addMonths, zonedParts, zonedTime, deviceTimeZone, HOUR, MINUTE } from './time.js';
import { totalsOf, inInterval, costByTransport } from './analytics.js';

const NOW_LABEL = { week: 'на этой неделе', month: 'в этом месяце', year: 'в этом году' };
const PREV_LABEL = { week: 'прошлой недели', month: 'прошлого месяца', year: 'прошлого года' };
const TRANSPORT_NAMES = {
  walk: 'Пешком', bus: 'Автобус', minibus: 'Маршрутка', trolleybus: 'Троллейбус', tram: 'Трамвай',
  metro: 'Метро', train: 'Электричка', taxi: 'Такси', car: 'Авто', bicycle: 'Велосипед', scooter: 'Самокат', other: 'Прочее',
};
const pct = (x) => `${Math.round(Math.abs(x) * 100)} %`;
const hours = (ms) => `${(ms / HOUR).toFixed(1).replace('.', ',')} ч`;

/** Начало того же периода в прошлом (прошлая неделя / месяц / год). */
function previousPeriod(period, now, tz) {
  if (period === 'week') return periodInterval('week', addDays(periodInterval('week', now, tz).start, -1, tz), tz);
  if (period === 'month') return periodInterval('month', addMonths(now, -1, tz), tz);
  const y = zonedParts(now, tz).year - 1;
  return periodInterval('year', zonedTime(y, 6, 15, 12, 0, tz), tz);
}

/** Период «к дате» и те же дни прошлого периода. */
export function periodToDate(trips, period, now, tz = deviceTimeZone()) {
  const cur = periodInterval(period, now, tz);
  const tomorrow = addDays(startOfDay(now, tz), 1, tz);
  const prev = previousPeriod(period, now, tz);
  const elapsedDays = Math.round((Math.min(tomorrow, cur.end) - cur.start) / 86_400_000);
  const prevEnd = Math.min(addDays(prev.start, elapsedDays, tz), prev.end);
  return {
    current: totalsOf(inInterval(trips, { start: cur.start, end: Math.min(tomorrow, cur.end) })),
    previous: totalsOf(inInterval(trips, { start: prev.start, end: prevEnd })),
  };
}

/**
 * @param {Array} all все завершённые поездки (сводки)
 * @param {'week'|'month'|'year'} period
 * @returns {{text: string, tone: 'good'|'warn'|'neutral'}[]}
 */
export function insights(all, period, now, { tz = deviceTimeZone(), limit = 3 } = {}) {
  const out = [];
  const when = NOW_LABEL[period];
  const trips = inInterval(all, periodInterval(period, now, tz));
  if (!trips.length) return out;
  const totals = totalsOf(trips);

  // 1. Расходы против тех же дней прошлого периода
  const { current, previous } = periodToDate(all, period, now, tz);
  if (previous.cost > 0 && current.trips > 0) {
    const change = (current.cost - previous.cost) / previous.cost;
    if (Math.abs(change) < 0.05) {
      out.push({ tone: 'neutral', text: `${capital(when)} на дорогу ушло ${formatMoney(current.cost)} — столько же, сколько за те же дни ${PREV_LABEL[period]}.` });
    } else {
      out.push({
        tone: change > 0 ? 'warn' : 'good',
        text: `${capital(when)} на дорогу ушло ${formatMoney(current.cost)}: на ${pct(change)} ${change > 0 ? 'больше' : 'меньше'}, чем за те же дни ${PREV_LABEL[period]} (${formatMoney(previous.cost)}).`,
      });
    }
  }

  // 2. Куда уходят деньги
  const byTransport = Object.entries(costByTransport(trips)).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const spent = byTransport.reduce((a, [, v]) => a + v, 0);
  if (byTransport.length >= 2 && spent > 0) {
    const [k, v] = byTransport[0];
    out.push({ tone: 'neutral', text: `${TRANSPORT_NAMES[k] ?? k} — ${pct(v / spent)} расходов ${when} (${formatMoney(v)}).` });
  }

  // 3. Какая дорога дольше
  const avg = (dir) => {
    const ts = trips.filter((t) => t.direction === dir);
    return ts.length >= 2 ? ts.reduce((a, t) => a + t.activeMs, 0) / ts.length : null;
  };
  const toWork = avg('to_work');
  const toHome = avg('to_home');
  if (toWork != null && toHome != null && Math.abs(toHome - toWork) >= 5 * MINUTE) {
    const homeLonger = toHome > toWork;
    out.push({
      tone: 'neutral',
      text: `${homeLonger ? 'Домой' : 'На работу'} вы едете дольше: в среднем ${formatDuration(homeLonger ? toHome : toWork)} против ${formatDuration(homeLonger ? toWork : toHome)} ${homeLonger ? 'на работу' : 'домой'} ${when}.`,
    });
  }

  // 4. Время в дороге в рабочих днях
  if (totals.activeMs >= 4 * HOUR) {
    const days = (totals.activeMs / (8 * HOUR)).toFixed(1).replace('.', ',');
    out.push({ tone: 'neutral', text: `${capital(when)} в дороге ${hours(totals.activeMs)} — это ${days} рабочего дня по 8 часов.` });
  }

  // 5. Контролёры
  const withController = trips.filter((t) => t.controllers > 0).length;
  if (withController > 0) {
    out.push({ tone: 'neutral', text: `Контролёр встречался в ${withController} из ${trips.length} поездок ${when}.` });
  }

  return out.slice(0, limit);
}

const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
