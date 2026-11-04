import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatMoney, parseMoney, uah, divideMoney, moneyToInput } from '../src/core/money.js';
import {
  activeDuration, splitByDay, zonedTime, periodInterval, startOfDay, formatDuration, HOUR, MINUTE,
} from '../src/core/time.js';
import { distance, trackDistance, detectStops, gpsPolicy } from '../src/core/geo.js';
import {
  tripCost, tripTransfers, totalsOf, inInterval, costByDirection, costByTransport, dailySeries,
  monthComparison, forecast, compareRoutes, projectSavings, averageCommuteDayCost, dailyTotals,
  monthToDateComparison, routeStats, segmentSignature,
} from '../src/core/analytics.js';
import { wilson, reliability, inspectionStats } from '../src/core/inspections.js';
import { reduce, initialState, sessionActiveMs } from '../src/core/tracking.js';
import { mergeOp, readyOps, markFailed, backoffMs, resolveConflict } from '../src/core/sync-policy.js';
import { validateTrip, emptyFilter, matchesFilter, activeFilterCount, monthGrid } from '../src/core/editing.js';

const TZ = 'Europe/Kyiv';
const NB = ' ';
const d = (y, m, day, h = 0, min = 0) => zonedTime(y, m, day, h, min, TZ);
const trip = (start, minutes, { direction = 'to_work', segments = [], controllers = 0, routeId = null } = {}) => ({
  id: crypto.randomUUID(), direction, startedAt: start, finishedAt: start + minutes * MINUTE,
  activeMs: minutes * MINUTE, timeZone: TZ, extraCost: 0, controllers, routeId,
  segments: segments.map(([transport, cost, number]) => ({ transport, cost, number })),
});

describe('Деньги', () => {
  test('форматирование', () => {
    assert.equal(formatMoney(uah(30)), `30${NB}₴`);
    assert.equal(formatMoney(uah(30, 50)), `30,50${NB}₴`);
    assert.equal(formatMoney(uah(30, 5)), `30,05${NB}₴`);
    assert.equal(formatMoney(uah(1250)), `1${NB}250${NB}₴`);
    assert.equal(formatMoney(uah(1_000_000)), `1${NB}000${NB}000${NB}₴`);
    assert.equal(formatMoney(-1200), `−12${NB}₴`);
  });
  test('разбор ввода', () => {
    for (const [input, expected] of [['30', 3000], ['30,5', 3050], ['30.50', 3050], ['1 250,00', 125000], ['0,01', 1], ['18 ₴', 1800]]) {
      assert.equal(parseMoney(input), expected, input);
    }
    for (const bad of ['', 'abc', '-5', '1,234', '1.2.3', '.']) assert.equal(parseMoney(bad), null, bad);
    assert.equal(moneyToInput(3050), '30,50');
    assert.equal(moneyToInput(0), '');
  });
  test('среднее с округлением', () => {
    assert.equal(divideMoney(uah(100), 3), 3333);
    assert.equal(divideMoney(uah(100), 0), null);
  });
});

describe('Время', () => {
  test('паузы с перекрытием и выходом за границы', () => {
    const s = d(2026, 11, 3, 8), e = d(2026, 11, 3, 9);
    const pauses = [
      { start: d(2026, 11, 3, 8, 10), end: d(2026, 11, 3, 8, 20) },
      { start: d(2026, 11, 3, 8, 15), end: d(2026, 11, 3, 8, 25) },
      { start: d(2026, 11, 3, 7, 50), end: d(2026, 11, 3, 8, 5) },
    ];
    assert.equal(activeDuration(s, e, pauses), 40 * MINUTE);
    assert.equal(activeDuration(e, s), 0);
  });
  test('полночь делит поездку между днями', () => {
    const parts = splitByDay(d(2026, 11, 3, 23, 40), d(2026, 11, 4, 0, 30), TZ);
    assert.deepEqual(parts.map((p) => p.ms), [20 * MINUTE, 30 * MINUTE]);
    assert.equal(parts[1].day, d(2026, 11, 4));
  });
  test('перевод часов (Киев, 26.10.2025)', () => {
    const parts = splitByDay(d(2025, 10, 25, 23), d(2025, 10, 26, 5), TZ);
    assert.equal(parts.reduce((a, p) => a + p.ms, 0), 7 * HOUR);
    const day = periodInterval('day', d(2025, 10, 26, 12), TZ);
    assert.equal(day.end - day.start, 25 * HOUR);
  });
  test('неделя с понедельника, месяц', () => {
    const w = periodInterval('week', d(2026, 11, 4, 12), TZ);
    assert.equal(w.start, d(2026, 11, 2));
    const m = periodInterval('month', d(2026, 11, 15), TZ);
    assert.equal(m.start, d(2026, 11, 1));
    assert.equal(m.end, d(2026, 12, 1));
    assert.equal(startOfDay(d(2026, 11, 3, 23, 59), TZ), d(2026, 11, 3));
  });
  test('формат длительности', () => {
    assert.equal(formatDuration(65 * MINUTE), '1 ч 05 мин');
    assert.equal(formatDuration(45 * MINUTE), '45 мин');
  });
});

describe('GPS', () => {
  const t0 = d(2026, 11, 3, 8);
  const s = (lat, lon, sec, acc = 10) => ({ lat, lon, t: t0 + sec * 1000, acc });
  test('гаверсинус', () => {
    assert.ok(Math.abs(distance({ lat: 50, lon: 30 }, { lat: 51, lon: 30 }) - 111_195) < 50);
  });
  test('дрожание на месте не накапливается', () => {
    const samples = Array.from({ length: 60 }, (_, i) => s(50.45 + (i % 2 ? -0.00004 : 0.00004), 30.52, i * 10));
    assert.equal(trackDistance(samples), 0);
  });
  test('неточные отметки и скачки отбрасываются', () => {
    const samples = [s(50.45, 30.52, 0), s(50.451, 30.52, 60), s(50.55, 30.52, 61), s(50.452, 30.52, 120, 300), s(50.452, 30.52, 180)];
    assert.ok(Math.abs(trackDistance(samples) - 222.4) < 2);
  });
  test('остановка', () => {
    const samples = [
      ...Array.from({ length: 6 }, (_, i) => s(50.45 + i * 0.001, 30.52, i * 20)),
      ...Array.from({ length: 12 }, (_, i) => s(50.4551, 30.52, 120 + i * 15)),
      ...Array.from({ length: 3 }, (_, i) => s(50.457 + i * 0.001, 30.52, 320 + i * 20)),
    ];
    const stops = detectStops(samples);
    assert.equal(stops.length, 1);
    assert.ok(stops[0].end - stops[0].start >= 150_000);
  });
  test('экономия батареи', () => {
    assert.equal(gpsPolicy({ lowBattery: true }).enableHighAccuracy, false);
    assert.equal(gpsPolicy({ speed: 1.2 }).minDistance, 15);
  });
});

describe('Аналитика', () => {
  test('итоги и пересадки', () => {
    const t = trip(d(2026, 11, 3, 7, 40), 45, { segments: [['walk', 0], ['minibus', 2000], ['metro', 2800]] });
    assert.equal(tripCost(t), uah(48));
    assert.equal(tripTransfers(t), 1);
    const tot = totalsOf(inInterval([t], periodInterval('day', d(2026, 11, 3, 12), TZ)));
    assert.equal(tot.trips, 1);
    assert.deepEqual([...tot.transports].sort(), ['metro', 'minibus', 'walk']);
  });
  test('по направлениям и транспорту', () => {
    const ts = [
      trip(d(2026, 11, 3, 8), 40, { segments: [['minibus', 2000], ['metro', 1000]] }),
      trip(d(2026, 11, 3, 18), 50, { direction: 'to_home', segments: [['metro', 1000]] }),
    ];
    assert.deepEqual(costByDirection(ts), { to_work: uah(30), to_home: uah(10) });
    assert.deepEqual(costByTransport(ts), { minibus: uah(20), metro: uah(20) });
    assert.equal(averageCommuteDayCost(ts, TZ), uah(40));
    const daily = dailyTotals(ts, TZ).get(d(2026, 11, 3));
    assert.equal(daily.trips, 2);
    assert.equal(daily.activeMs, 90 * MINUTE);
  });
  test('сравнение месяцев', () => {
    const ts = [trip(d(2026, 10, 15, 8), 40, { segments: [['metro', 2000]] }), trip(d(2026, 11, 3, 8), 60, { segments: [['metro', 3000]] })];
    const c = monthComparison(ts, d(2026, 11, 20), TZ);
    assert.equal(c.costChange, 0.5);
    assert.equal(c.timeChange, 0.5);
  });
  test('ряд по дням недели', () => {
    const ts = [trip(d(2026, 11, 3, 8), 30, { segments: [['bus', 1500]] })];
    const series = dailySeries(ts, periodInterval('week', d(2026, 11, 4), TZ), TZ);
    assert.equal(series.length, 7);
    assert.equal(series[1].cost, uah(15));
  });
  test('прогноз: мало данных → нет прогноза', () => {
    const ts = [2, 3].map((day) => trip(d(2026, 11, day, 8), 30, { segments: [['metro', 5000]] }));
    assert.equal(forecast(ts, 'month', d(2026, 11, 4, 12), { tz: TZ }), null);
  });
  test('прогноз на месяц', () => {
    const ts = [];
    for (let day = d(2026, 9, 9); day <= d(2026, 11, 4); day = startOfDay(day + 26 * HOUR, TZ)) {
      const wd = new Date(day + 12 * HOUR).getUTCDay();
      if (wd === 0 || wd === 6) continue;
      ts.push(trip(day + 8 * HOUR, 30, { segments: [['metro', 5000]] }));
      ts.push(trip(day + 9 * HOUR, 30, { direction: 'to_home', segments: [['metro', 5000]] }));
    }
    const f = forecast(ts, 'month', d(2026, 11, 4, 12), { tz: TZ });
    assert.equal(f.averagePerDay, uah(100));
    assert.equal(f.rate, 1);
    assert.equal(f.projected, uah(2100)); // 300 ₴ потрачено + 18 будних дней × 100 ₴
  });
  test('месяц к дате сравнивается с теми же днями прошлого месяца', () => {
    const ts = [
      trip(d(2026, 10, 2, 8), 40, { segments: [['metro', 2000]] }),   // 1–4 октября: 20 ₴
      trip(d(2026, 10, 20, 8), 40, { segments: [['metro', 8000]] }),  // позже в октябре — не входит
      trip(d(2026, 11, 3, 8), 40, { segments: [['metro', 3000]] }),
    ];
    const c = monthToDateComparison(ts, d(2026, 11, 4, 12), TZ);
    assert.equal(c.current.cost, 3000);
    assert.equal(c.previous.cost, 2000);
    assert.equal(c.previousFull.cost, 10000);
    assert.equal(c.costChange, 0.5);
  });
  test('прогноз не считает недели до первой поездки', () => {
    const ts = [];
    for (let day = d(2026, 10, 19); day <= d(2026, 11, 4); day = startOfDay(day + 26 * HOUR, TZ)) {
      const wd = new Date(day + 12 * HOUR).getUTCDay();
      if (wd === 0 || wd === 6) continue;
      ts.push(trip(day + 8 * HOUR, 30, { segments: [['metro', 5000]] }));
    }
    const f = forecast(ts, 'month', d(2026, 11, 4, 12), { tz: TZ });
    assert.equal(f.rate, 1);
  });
  test('сравнение реальных маршрутов', () => {
    const ts = [
      trip(d(2026, 11, 2, 8), 40, { segments: [['minibus', 2000, '720'], ['metro', 800]] }),
      trip(d(2026, 11, 3, 8), 50, { segments: [['minibus', 2000, '720'], ['metro', 800]] }),
      trip(d(2026, 11, 4, 8), 60, { segments: [['bus', 1500, '24']] }),
    ];
    const stats = routeStats(ts, (t) => ({ key: segmentSignature(t), label: segmentSignature(t) }));
    assert.equal(stats[0].key, 'minibus:720>metro');
    assert.equal(stats[0].count, 2);
    assert.equal(stats[0].avgMs, 45 * MINUTE);
    assert.equal(stats[0].avgCost, 2800);
  });
  test('калькулятор экономии из ТЗ', () => {
    const r = compareRoutes({ name: 'А', minutes: 35, cost: uah(30) }, { name: 'Б', minutes: 50, cost: uah(18) });
    assert.equal(r.verdict, 'tradeoff');
    assert.equal(r.cheaper, 'Б');
    assert.equal(r.saved, uah(12));
    assert.equal(r.minutesLost, 15);
    assert.equal(r.perMinute, 80);
    assert.deepEqual(projectSavings(r, 44), { money: uah(528), hours: 11 });
    assert.equal(compareRoutes({ name: 'А', minutes: 30, cost: 2000 }, { name: 'Б', minutes: 40, cost: 2500 }).winner, 'А');
    assert.equal(compareRoutes({ name: 'А', minutes: 50, cost: 2000 }, { name: 'Б', minutes: 40, cost: 2000 }).winner, 'Б');
    assert.equal(compareRoutes({ name: 'А', minutes: 40, cost: 2000 }, { name: 'Б', minutes: 40, cost: 2000 }).verdict, 'identical');
  });
});

describe('Контролёры', () => {
  test('интервал Уилсона при малой выборке', () => {
    const ci = wilson(0, 5);
    assert.ok(ci.low < 1e-9);
    assert.ok(Math.abs(ci.high - 0.4345) < 0.001);
    assert.equal(reliability(9), 'insufficient');
    assert.equal(reliability(10), 'low');
    assert.equal(reliability(30), 'moderate');
    assert.equal(reliability(100), 'good');
  });
  test('«неизвестно» не входит в знаменатель', () => {
    const at = d(2026, 11, 3, 8);
    const st = inspectionStats([
      { outcome: 'ticket_checked', observedAt: at, transport: 'metro' },
      { outcome: 'present_not_checked', observedAt: at, transport: 'metro' },
      { outcome: 'no_controller', observedAt: at + 9 * HOUR, transport: 'minibus', route: '720' },
      { outcome: 'checked_at_transfer', observedAt: at, transport: 'metro' },
      { outcome: 'unknown', observedAt: at },
    ], TZ);
    assert.equal(st.known, 4);
    assert.equal(st.encounters, 3);
    assert.equal(st.checks, 2);
    assert.equal(st.checkRate.estimate, 0.5);
    assert.equal(st.byHour.get(8).trials, 3);
    assert.equal(st.byHour.get(17).successes, 0);
    assert.equal(st.byRoute.get('720').trials, 1);
  });
});

describe('Машина состояний', () => {
  const t0 = d(2026, 11, 3, 7, 40);
  const at = (m) => t0 + m * MINUTE;
  const run = (events) => events.reduce((acc, e) => {
    const r = reduce(acc.state, e, () => 'trip-1');
    return { state: r.state, effects: [...acc.effects, ...r.effects] };
  }, { state: initialState(), effects: [] });

  test('двойной старт игнорируется', () => {
    const r = run([{ type: 'start', direction: 'to_work', mode: 'manual', at: t0 }, { type: 'start', direction: 'to_work', mode: 'manual', at: at(1) }]);
    assert.equal(r.effects.filter((e) => e.type === 'tripStarted').length, 1);
  });
  test('паузы исключаются, завершение на паузе закрывает её', () => {
    const r = run([
      { type: 'start', direction: 'to_work', mode: 'manual', at: t0 },
      { type: 'pause', at: at(10) }, { type: 'pause', at: at(11) }, { type: 'resume', at: at(20) },
      { type: 'pause', at: at(30) }, { type: 'finish', at: at(40) },
    ]);
    const fin = r.effects.find((e) => e.type === 'tripFinished');
    assert.equal(activeDuration(fin.session.startedAt, fin.end, fin.session.pauses), 20 * MINUTE);
    assert.equal(r.state.status, 'idle');
  });
  test('GPS: старт/стоп и отказ в доступе без потери поездки', () => {
    const r = run([{ type: 'start', direction: 'to_work', mode: 'gps', at: t0 }, { type: 'gpsDenied' }]);
    assert.ok(r.effects.some((e) => e.type === 'startGps'));
    assert.ok(r.effects.some((e) => e.type === 'degradedToManual'));
    assert.equal(r.state.session.mode, 'manual');
    assert.equal(sessionActiveMs(r.state.session, at(10)), 10 * MINUTE);
  });
  test('прибытие к месту предлагает завершить один раз', () => {
    const work = { lat: 50.44, lon: 30.54, radius: 200, name: 'Работа' };
    const r = run([
      { type: 'start', direction: 'to_work', mode: 'gps', at: t0 },
      { type: 'position', point: { lat: 50.44, lon: 30.54 }, places: [work], at: at(2) }, // слишком рано
      { type: 'position', point: { lat: 50.4401, lon: 30.5401 }, places: [work], at: at(40) },
      { type: 'position', point: { lat: 50.44, lon: 30.54 }, places: [work], at: at(41) },
    ]);
    assert.equal(r.effects.filter((e) => e.type === 'suggestFinish').length, 1);
  });
  test('GPS можно включить посреди ручной поездки', () => {
    const r = run([{ type: 'start', direction: 'to_work', mode: 'manual', at: t0 }, { type: 'enableGps', at: at(3) }]);
    assert.equal(r.state.session.mode, 'gps');
    assert.ok(r.effects.some((e) => e.type === 'startGps'));
  });
  test('состояние сериализуется', () => {
    const r = run([{ type: 'start', direction: 'to_home', mode: 'gps', at: t0 }, { type: 'pause', at: at(5) }]);
    assert.deepEqual(JSON.parse(JSON.stringify(r.state)), r.state);
  });
});

describe('Очередь синхронизации', () => {
  const now = d(2026, 11, 3, 9);
  const op = (entity, kind, enqueuedAt = now) => ({ id: crypto.randomUUID(), entity, entityId: crypto.randomUUID(), kind, enqueuedAt, attempts: 0, nextAttemptAt: enqueuedAt });
  test('удаление поглощает upsert', () => {
    const a = op('trips', 'upsert');
    const merged = mergeOp(mergeOp(a, { ...a, kind: 'delete' }), { ...a, kind: 'upsert' });
    assert.equal(merged.kind, 'delete');
  });
  test('порядок отправки', () => {
    const ops = [op('inspections', 'upsert'), op('trip_segments', 'upsert'), op('trips', 'upsert', now + 5), op('trips', 'delete'), op('trip_segments', 'delete')];
    assert.deepEqual(readyOps(ops, now + 10).map((o) => `${o.kind}:${o.entity}`),
      ['upsert:trips', 'upsert:trip_segments', 'upsert:inspections', 'delete:trip_segments', 'delete:trips']);
  });
  test('бэкофф', () => {
    const f = markFailed(op('trips', 'upsert'), 'offline', now, 0.5);
    assert.equal(f.nextAttemptAt, now + 2000);
    assert.equal(readyOps([f], now).length, 0);
    assert.ok(backoffMs(50, 1) <= 900 * 1.25 * 1000);
  });
  test('конфликты: последняя правка побеждает, удаление не воскрешается', () => {
    const early = '2026-11-03T08:00:00Z', late = '2026-11-03T09:00:00Z';
    assert.equal(resolveConflict({ updated_at: late }, { updated_at: early }), 'local');
    assert.equal(resolveConflict({ updated_at: early }, { updated_at: late }), 'remote');
    assert.equal(resolveConflict({ updated_at: early }, { updated_at: late, deleted_at: late }), 'remote');
  });
});

describe('Редактирование, фильтры, календарь', () => {
  const s = d(2026, 11, 3, 8), now = d(2026, 11, 3, 12);
  const at = (m) => s + m * MINUTE;
  test('проверка поездки', () => {
    assert.deepEqual(validateTrip({ start: s, end: at(50), segments: [{ start: at(0), end: at(20) }, { start: at(25), end: at(50) }], now }), []);
    assert.deepEqual(validateTrip({ start: s, end: s, segments: [], now }).map((i) => i.code), ['endBeforeStart']);
    const w = validateTrip({ start: s, end: at(50), segments: [{ start: at(0), end: at(30) }, { start: at(20), end: at(70) }], now });
    assert.ok(w.some((i) => i.code === 'segmentsOverlap') && w.every((i) => !i.blocking));
    assert.deepEqual(validateTrip({ start: d(2026, 11, 3, 23, 40), end: d(2026, 11, 4, 0, 30), segments: [], now: d(2026, 11, 4, 9) }), []);
  });
  test('фильтры', () => {
    const ts = [
      trip(d(2026, 11, 3, 8), 60, { segments: [['minibus', 2000, '720'], ['metro', 800]], controllers: 1, routeId: 'r1' }),
      trip(d(2026, 11, 3, 18), 60, { direction: 'to_home', segments: [['bus', 1500, '24']] }),
      trip(d(2026, 11, 5, 8), 60, { segments: [['taxi', 18000]] }),
    ];
    const count = (patch) => ts.filter((t) => matchesFilter({ ...emptyFilter(), ...patch }, t)).length;
    assert.equal(count({}), 3);
    assert.equal(count({ directions: ['to_work'] }), 2);
    assert.equal(count({ directions: ['to_work'], transports: ['metro', 'bus'] }), 1);
    assert.equal(count({ minCost: 2000, maxCost: 10000 }), 1);
    assert.equal(count({ controllers: 'met' }), 1);
    assert.equal(count({ controllers: 'notMet' }), 2);
    assert.equal(count({ routeId: 'r1' }), 1);
    assert.equal(count({ routeNumber: ' 72 ' }), 1);
    assert.equal(count({ from: d(2026, 11, 4), to: d(2026, 11, 6) }), 1);
    assert.equal(activeFilterCount({ ...emptyFilter(), directions: ['to_work'], minCost: 1 }), 2);
  });
  test('ноябрь 2026 начинается в воскресенье', () => {
    const g = monthGrid(d(2026, 11, 15), TZ);
    assert.ok(g.cells.slice(0, 6).every((c) => c === null));
    assert.equal(g.cells[6], d(2026, 11, 1));
    assert.equal(g.cells.filter(Boolean).length, 30);
    assert.equal(g.cells.length % 7, 0);
  });
});
