// «Обычная поездка», выводы, бюджет, резервная копия, индексы и миграции хранилища.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { zonedTime, zonedParts, MINUTE, HOUR } from '../src/core/time.js';
import { usualPlan, placeToday, loggedToday } from '../src/core/usual.js';
import { insights, periodToDate } from '../src/core/insights.js';
import { monthBudget } from '../src/core/analytics.js';
import { buildBackup, parseBackup, backupDue } from '../src/core/backup.js';
import { Store } from '../src/data/store.js';
import { MemoryBackend, MIGRATIONS, DB_VERSION, upgrade, STORES } from '../src/data/db.js';

const TZ = 'Europe/Kyiv';
const d = (y, m, day, h = 0, min = 0) => zonedTime(y, m, day, h, min, TZ);
let n = 0;
const trip = (start, minutes, { direction = 'to_work', segments = [['minibus', 2000, '720']], controllers = 0, routeId = null } = {}) => ({
  id: `t${++n}`, direction, startedAt: start, finishedAt: start + minutes * MINUTE, activeMs: minutes * MINUTE,
  extraCost: 0, controllers, routeId, segments: segments.map(([transport, cost, number]) => ({ transport, cost, number })),
});
const newestFirst = (xs) => [...xs].sort((a, b) => b.startedAt - a.startedAt);

describe('Обычная поездка', () => {
  test('берёт самый частый набор этапов, медианное время выезда и длительность', () => {
    const trips = newestFirst([
      trip(d(2026, 11, 2, 8, 10), 44),
      trip(d(2026, 10, 30, 8, 5), 46, { segments: [['taxi', 15000]] }), // разовое такси не должно стать «обычным»
      trip(d(2026, 10, 29, 8, 20), 50),
      trip(d(2026, 10, 28, 8, 0), 40),
      trip(d(2026, 10, 28, 18, 0), 55, { direction: 'to_home' }),
    ]);
    const plan = usualPlan(trips, 'to_work', { tz: TZ });
    assert.equal(plan.cost, 2000);
    assert.equal(plan.basedOn, 3);
    assert.equal(plan.startMinute, 8 * 60 + 10);
    assert.equal(plan.durationMs, 44 * MINUTE);
    assert.deepEqual(plan.segments.map((s) => s.transport), ['minibus']);
    assert.equal(usualPlan(trips, 'other', { tz: TZ }), null);
  });

  test('одна поездка в направлении — план «как в прошлый раз»', () => {
    const plan = usualPlan([trip(d(2026, 11, 2, 18, 30), 52, { direction: 'to_home' })], 'to_home', { tz: TZ });
    assert.equal(plan.basedOn, 1);
    assert.equal(plan.startMinute, 18 * 60 + 30);
  });

  test('время сегодня: обычное, а если оно ещё не прошло — поездка заканчивается сейчас', () => {
    const plan = { startMinute: 8 * 60 + 10, durationMs: 45 * MINUTE };
    const late = placeToday(plan, d(2026, 11, 4, 12, 0), TZ);
    assert.equal(late.start, d(2026, 11, 4, 8, 10));
    assert.equal(late.end, d(2026, 11, 4, 8, 55));
    const early = placeToday(plan, d(2026, 11, 4, 8, 30), TZ);
    assert.equal(early.end, d(2026, 11, 4, 8, 30));
    assert.equal(early.start, d(2026, 11, 4, 7, 45));
  });

  test('уже записана сегодня', () => {
    const trips = [trip(d(2026, 11, 4, 8, 10), 44)];
    assert.equal(loggedToday(trips, 'to_work', d(2026, 11, 4, 20, 0), TZ), true);
    assert.equal(loggedToday(trips, 'to_home', d(2026, 11, 4, 20, 0), TZ), false);
    assert.equal(loggedToday(trips, 'to_work', d(2026, 11, 5, 7, 0), TZ), false);
  });
});

describe('Выводы словами', () => {
  const now = d(2026, 11, 10, 20, 0);
  const all = [
    // прошлый месяц, те же дни (1–10 октября): 2 поездки по 20 ₴
    trip(d(2026, 10, 2, 8, 0), 40), trip(d(2026, 10, 3, 8, 0), 40),
    // этот месяц: 3 поездки на работу (маршрутка + метро) и 2 домой — дольше
    ...[3, 4, 5].map((day) => trip(d(2026, 11, day, 8, 0), 40, { segments: [['minibus', 2000], ['metro', 800]] })),
    trip(d(2026, 11, 3, 18, 0), 60, { direction: 'to_home', controllers: 1 }),
    trip(d(2026, 11, 4, 18, 0), 56, { direction: 'to_home' }),
  ];

  test('сравнение с теми же днями прошлого периода, доля транспорта, разница направлений', () => {
    const out = insights(all, 'month', now, { tz: TZ, limit: 5 });
    const text = out.map((x) => x.text).join('\n');
    assert.match(out[0].text, /^В этом месяце на дорогу ушло 124 ₴: на 210 % больше, чем за те же дни прошлого месяца \(40 ₴\)\./);
    assert.equal(out[0].tone, 'warn');
    assert.match(text, /Маршрутка — 81 % расходов в этом месяце \(100 ₴\)\./);
    assert.match(text, /Домой вы едете дольше: в среднем 58 мин против 40 мин на работу в этом месяце\./);
    assert.match(text, /Контролёр встречался в 1 из 5 поездок в этом месяце\./);
    assert.equal(insights(all, 'month', now, { tz: TZ }).length, 3);
  });

  test('без поездок в периоде выводов нет; без прошлого периода нет сравнения', () => {
    assert.deepEqual(insights(all, 'week', d(2026, 12, 20, 12, 0), { tz: TZ }), []);
    const fresh = insights(all.slice(2), 'month', now, { tz: TZ });
    assert.ok(!fresh.some((x) => x.text.includes('прошлого месяца')));
  });

  test('неделя к дате сравнивается с теми же днями прошлой недели', () => {
    const w = periodToDate([trip(d(2026, 11, 2, 8, 0), 40), trip(d(2026, 11, 6, 8, 0), 40), trip(d(2026, 11, 10, 8, 0), 40)], 'week', d(2026, 11, 10, 20, 0), TZ);
    assert.equal(w.current.trips, 1); // вторник 10-го
    assert.equal(w.previous.trips, 1); // понедельник 2-го; пятница 6-го — уже не «те же дни»
  });
});

describe('Бюджет месяца', () => {
  test('потрачено, остаток в будний день и вердикт по прогнозу', () => {
    const now = d(2026, 11, 13, 20, 0);
    const trips = [2, 3, 4, 5, 6, 9, 10, 11, 12, 13].map((day) => trip(d(2026, 11, day, 8, 0), 40, { segments: [['minibus', 5000]] }));
    const b = monthBudget(trips, 100_000, now, TZ);
    assert.equal(b.spent, 50_000);
    assert.equal(b.left, 50_000);
    assert.equal(b.weekdaysLeft, 11); // 16–30 ноября
    assert.equal(b.perWeekday, Math.floor(50_000 / 11));
    assert.equal(b.verdict, 'risk'); // 50 ₴ в каждый будний день → 1 100 ₴ к концу месяца
    assert.ok(b.projected > 100_000);
    assert.equal(monthBudget(trips, 200_000, now, TZ).verdict, 'within');
    assert.equal(monthBudget(trips, 40_000, now, TZ).verdict, 'over');
    assert.equal(monthBudget(trips, 0, now, TZ), null);
  });

  test('мало данных для прогноза — вердикт неизвестен, но остаток считается', () => {
    const b = monthBudget([trip(d(2026, 11, 2, 8, 0), 40)], 100_000, d(2026, 11, 3, 9, 0), TZ);
    assert.equal(b.projected, null);
    assert.equal(b.verdict, 'unknown');
    assert.equal(b.left, 98_000);
  });
});

describe('Резервная копия', () => {
  test('формат, проверка и понятные ошибки', () => {
    const backup = buildBackup({ trips: [{ id: 'a', updated_at: 1, started_at: 1, direction: 'to_work' }] }, { budget: 5 }, 0);
    assert.equal(backup.app, 'road-tracker');
    const parsed = parseBackup(JSON.stringify(backup));
    assert.equal(parsed.counts.trips, 1);
    assert.deepEqual(parsed.settings, { budget: 5 });
    // ранний экспорт — только таблицы
    assert.equal(parseBackup({ trips: [], routes: [] }).counts.routes, 0);
    assert.throws(() => parseBackup('not json'), /не JSON/);
    assert.throws(() => parseBackup({ app: 'other', trips: [] }), /другим приложением/);
    assert.throws(() => parseBackup({ format: 99, trips: [] }), /новой версией/);
    assert.throws(() => parseBackup({ foo: 1 }), /нет поездок/);
    assert.throws(() => parseBackup({ trips: [{ id: 'x' }] }), /повреждён/);
    assert.throws(() => parseBackup({ trips: [{ id: 'x', updated_at: 1, started_at: 1, direction: 'up' }] }), /направления/);
  });

  test('напоминание: раз в неделю, только без облака и при наличии поездок', () => {
    const DAY = 86_400_000;
    const base = { trips: 10, lastBackupAt: 0, firstTripAt: 0, cloud: false };
    assert.equal(backupDue({ ...base, now: 6 * DAY }), false);
    assert.equal(backupDue({ ...base, now: 7 * DAY }), true);
    assert.equal(backupDue({ ...base, cloud: true, now: 30 * DAY }), false);
    assert.equal(backupDue({ ...base, trips: 2, now: 30 * DAY }), false);
    assert.equal(backupDue({ ...base, lastBackupAt: null, firstTripAt: 10 * DAY, now: 12 * DAY }), false);
  });
});

describe('Хранилище: копия, индексы, производительность', () => {
  const T0 = Date.parse('2026-11-03T06:00:00Z');
  const clock = () => T0 + 3 * HOUR;
  async function storeWithTrip(backend = new MemoryBackend()) {
    const store = new Store(backend, { clock, timeZone: TZ });
    await store.load();
    const dr = store.emptyDraft();
    dr.started_at = T0;
    dr.finished_at = T0 + 45 * MINUTE;
    dr.segments = [store.newSegmentDraft({ transport_type: 'minibus', transport_number: '720', cost: 2000 })];
    const id = await store.saveTrip(dr);
    return { store, id };
  }

  test('восстановление в пустой браузер: всё на месте и уходит в очередь облака', async () => {
    const { store } = await storeWithTrip();
    const file = JSON.stringify(buildBackup(store.backupTables(), { budget: 150_000 }));
    const fresh = new Store(new MemoryBackend(), { clock, timeZone: TZ });
    await fresh.load();
    const r = await fresh.importBackup(parseBackup(file));
    assert.deepEqual(r, { added: 2, updated: 0, unchanged: 0 });
    assert.equal(fresh.tripCost(fresh.liveTrips()[0]), 2000);
    assert.equal(fresh.queue().length, 2);
    assert.equal(fresh.meta('settings').budget, 150_000);
    // повторное восстановление ничего не меняет
    assert.deepEqual(await fresh.importBackup(parseBackup(file)), { added: 0, updated: 0, unchanged: 2 });
  });

  test('восстановление не перетирает более свежую правку и пропускает незавершённые поездки', async () => {
    const { store, id } = await storeWithTrip();
    const tables = store.backupTables();
    const older = { ...tables.trips[0], comment: 'старое', updated_at: 1 };
    const live = { id: 'live', direction: 'to_work', started_at: T0, status: 'active', updated_at: T0 };
    const r = await store.importBackup({ tables: { ...tables, trips: [older, live], trip_segments: [] } });
    assert.equal(store.trip(id).comment, null);
    assert.equal(store.trip('live'), null);
    assert.equal(r.added, 0);
  });

  test('индексы по поездке остаются верными после правок, удаления и перезагрузки', async () => {
    const backend = new MemoryBackend();
    const { store, id } = await storeWithTrip(backend);
    const dr = store.draftFromTrip(store.trip(id));
    dr.segments.push(store.newSegmentDraft({ transport_type: 'metro', cost: 800 }));
    await store.saveTrip(dr);
    assert.deepEqual(store.segmentsOf(id).map((s) => s.transport_type), ['minibus', 'metro']);
    await store.addTrackPoints(id, [{ t: 2, lat: 50, lon: 30, acc: 5 }, { t: 1, lat: 50, lon: 30, acc: 5 }]);
    assert.deepEqual(store.trackOf(id).map((p) => p.t), [1, 2]);
    const reopened = new Store(backend, { clock, timeZone: TZ });
    await reopened.load();
    assert.equal(reopened.segmentsOf(id).length, 2);
    assert.equal(reopened.trackOf(id).length, 2);
    await reopened.deleteTrip(id);
    assert.equal(reopened.segmentsOf(id).length, 0);
    assert.equal(reopened.trackOf(id).length, 2, 'трек остаётся — поездку можно восстановить');
    await reopened.restoreTrip(id);
    assert.equal(reopened.segmentsOf(id).length, 2);
  });

  test('сводки кэшируются до следующего изменения', async () => {
    const { store } = await storeWithTrip();
    const a = store.completedSummaries();
    assert.equal(store.completedSummaries(), a);
    await store.setMeta('x', 1);
    assert.notEqual(store.completedSummaries(), a);
    const list = store.liveTrips();
    list.reverse(); // вызывающий код не может испортить кэш
    assert.equal(store.liveTrips().length, 1);
  });

  test('2 000 поездок: загрузка и сводки быстрые', async () => {
    const backend = new MemoryBackend();
    for (let i = 0; i < 2000; i++) {
      const id = `trip-${i}`;
      const start = T0 - i * 12 * HOUR;
      backend.data.trips.set(id, { id, direction: i % 2 ? 'to_home' : 'to_work', started_at: start, finished_at: start + 45 * MINUTE, pauses: [], extra_cost: 0, status: 'completed', updated_at: start, deleted_at: null });
      for (let k = 0; k < 2; k++) backend.data.trip_segments.set(`${id}-${k}`, { id: `${id}-${k}`, trip_id: id, position: k, transport_type: k ? 'metro' : 'minibus', cost: 1000, updated_at: start, deleted_at: null });
      if (i % 5 === 0) backend.data.inspections.set(`${id}-i`, { id: `${id}-i`, trip_id: id, segment_id: `${id}-0`, outcome: 'ticket_checked', updated_at: start, deleted_at: null });
    }
    const store = new Store(backend, { clock, timeZone: TZ });
    let t = performance.now();
    await store.load();
    const first = store.completedSummaries();
    const cold = performance.now() - t;
    t = performance.now();
    for (let i = 0; i < 100; i++) store.completedSummaries();
    const warm = (performance.now() - t) / 100;
    assert.equal(first.length, 2000);
    assert.equal(first[0].segments.length, 2);
    assert.ok(cold < 400, `загрузка и сводки: ${cold.toFixed(1)} мс`);
    assert.ok(warm < 1, `повторные сводки: ${warm.toFixed(3)} мс`);
    const screen = () => {
      insights(first, 'year', T0, { tz: TZ });
      monthBudget(first, 300_000, T0, TZ);
      usualPlan(first, 'to_work', { tz: TZ });
    };
    screen(); // первый расчёт прогревает кэш дат
    t = performance.now();
    for (let i = 0; i < 10; i++) screen();
    const perScreen = (performance.now() - t) / 10;
    assert.ok(perScreen < 16, `выводы, бюджет и обычная поездка укладываются в кадр: ${perScreen.toFixed(1)} мс`);
  });
});

describe('Миграции IndexedDB', () => {
  function fakeDb() {
    const stores = new Map();
    const os = (name) => ({
      indexNames: { contains: (i) => stores.get(name).indexes.has(i) },
      createIndex: (i) => stores.get(name).indexes.add(i),
    });
    const db = {
      objectStoreNames: { contains: (s) => stores.has(s) },
      createObjectStore: (s) => { stores.set(s, { indexes: new Set() }); return os(s); },
    };
    return { db, tx: { objectStore: os }, stores };
  }

  test('с нуля и с версии 1 база приходит к одной схеме; повторный запуск безопасен', () => {
    assert.equal(DB_VERSION, MIGRATIONS.length);
    const a = fakeDb();
    upgrade(a.db, a.tx, 0);
    const b = fakeDb();
    upgrade(b.db, b.tx, 0);
    upgrade(b.db, b.tx, 1);
    for (const s of STORES) assert.ok(a.stores.has(s), s);
    assert.deepEqual([...a.stores.get('trip_segments').indexes], ['trip_id']);
    assert.deepEqual([...b.stores.get('track_points').indexes], ['trip_id']);
    assert.equal(a.stores.get('meta').indexes.size, 0);
  });
});

void zonedParts;
