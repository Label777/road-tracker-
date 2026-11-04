import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Store, StoreError } from '../src/data/store.js';
import { MemoryBackend } from '../src/data/db.js';
import { SupabaseClient, SyncManager, toRemote, fromRemote } from '../src/data/sync.js';
import { reduce, initialState } from '../src/core/tracking.js';
import { MINUTE } from '../src/core/time.js';

const BASE = Date.parse('2026-11-03T06:00:00Z');
let clockNow = BASE + 3 * 3_600_000;
const clock = () => clockNow;

async function makeStore(backend = new MemoryBackend()) {
  const store = new Store(backend, { clock, timeZone: 'Europe/Kyiv' });
  await store.load();
  return store;
}

function draft(store) {
  const d = store.emptyDraft();
  d.started_at = BASE;
  d.finished_at = BASE + 45 * MINUTE;
  const a = store.newSegmentDraft({ transport_type: 'minibus', transport_number: '720', cost: 2000 });
  a.inspection = { id: crypto.randomUUID(), outcome: 'ticket_checked', observed_at: BASE + 10 * MINUTE, comment: '' };
  d.segments = [a, store.newSegmentDraft({ transport_type: 'metro', cost: 800 })];
  return d;
}

describe('Локальная база', () => {
  beforeEach(() => { clockNow = BASE + 3 * 3_600_000; });

  test('поездка с этапами и контролёром сохраняется атомарно вместе с очередью', async () => {
    const backend = new MemoryBackend();
    const store = await makeStore(backend);
    const id = await store.saveTrip(draft(store));
    const trip = store.trip(id);
    assert.equal(store.tripCost(trip), 2800);
    assert.deepEqual(store.segmentsOf(id).map((s) => s.transport_number), ['720', null]);
    assert.equal(store.inspectionsOf(id).length, 1);
    assert.equal(store.queue().length, 4);
    assert.equal(backend.commits, 1); // одно сохранение на всё

    // «Перезапуск»: всё читается с диска
    const reopened = await makeStore(backend);
    assert.equal(reopened.tripCost(reopened.trip(id)), 2800);
    assert.equal(reopened.queue().length, 4);
  });

  test('сбой записи на диск не меняет данные в памяти', async () => {
    const backend = new MemoryBackend();
    const store = await makeStore(backend);
    backend.failNext = true;
    await assert.rejects(store.saveTrip(draft(store)));
    assert.equal(store.liveTrips().length, 0);
    assert.equal(store.queue().length, 0);
  });

  test('повторное сохранение без изменений ничего не ставит в очередь', async () => {
    const store = await makeStore();
    const id = await store.saveTrip(draft(store));
    await store.completeOps(store.queue());
    await store.saveTrip(store.draftFromTrip(store.trip(id)));
    assert.equal(store.queue().length, 0);
  });

  test('удаление этапа удаляет и его наблюдение', async () => {
    const store = await makeStore();
    const id = await store.saveTrip(draft(store));
    await store.completeOps(store.queue());
    const d = store.draftFromTrip(store.trip(id));
    d.segments.shift();
    await store.saveTrip(d);
    assert.equal(store.segmentsOf(id).length, 1);
    assert.equal(store.inspectionsOf(id).length, 0);
    assert.equal(store.tripCost(store.trip(id)), 800);
    const kinds = store.queue().map((o) => `${o.entity}:${o.kind}`).sort();
    assert.deepEqual(kinds, ['inspections:delete', 'trip_segments:delete', 'trip_segments:upsert', 'trips:upsert']);
  });

  test('неверное время не сохраняется', async () => {
    const store = await makeStore();
    const d = draft(store);
    d.finished_at = d.started_at;
    await assert.rejects(store.saveTrip(d), StoreError);
  });

  test('живая запись: этапы, контролёр, завершение', async () => {
    const store = await makeStore();
    let state = initialState();
    const send = async (event) => {
      const r = reduce(state, event, () => 'trip-1');
      state = r.state;
      for (const e of r.effects) {
        if (e.type === 'tripStarted') await store.startTrip(e.session);
        if (e.type === 'tripFinished') await store.finishTrip(e.session, e.end);
      }
    };
    await send({ type: 'start', direction: 'to_work', mode: 'manual', at: BASE });
    await send({ type: 'start', direction: 'to_work', mode: 'manual', at: BASE + MINUTE }); // повтор — без дубля
    await store.appendLiveSegment('trip-1', { transport_type: 'minibus', transport_number: '720', cost: 2000 }, BASE);
    await store.recordInspection('trip-1', 'present_not_checked', BASE + 5 * MINUTE);
    await store.appendLiveSegment('trip-1', { transport_type: 'metro', cost: 800 }, BASE + 20 * MINUTE);
    await send({ type: 'finish', at: BASE + 40 * MINUTE });
    const segs = store.segmentsOf('trip-1');
    assert.equal(store.liveTrips().length, 1);
    assert.equal(segs[0].finished_at, BASE + 20 * MINUTE);
    assert.equal(segs[1].finished_at, BASE + 40 * MINUTE);
    assert.equal(store.inspectionsOf('trip-1')[0].segment_id, segs[0].id);
    assert.equal(store.trip('trip-1').status, 'completed');
    assert.equal(store.summary(store.trip('trip-1')).controllers, 1);
  });

  test('только один Дом', async () => {
    const store = await makeStore();
    const first = await store.savePlace({ kind: 'home', name: 'Дом', latitude: 50.45, longitude: 30.52, radius: 150 });
    const second = await store.savePlace({ kind: 'home', name: 'Новый дом', latitude: 50.40, longitude: 30.50, radius: 150 });
    assert.equal(store.data.locations.get(first).kind, 'other');
    assert.equal(store.data.locations.get(second).kind, 'home');
    await assert.rejects(store.savePlace({ kind: 'other', name: 'X', latitude: 50, longitude: 30, radius: 50 }), StoreError);
  });

  test('шаблон маршрута → черновик поездки', async () => {
    const store = await makeStore();
    const rid = await store.saveRoute({
      name: 'Утро', direction: 'to_work',
      segments: [{ transport_type: 'minibus', transport_number: '720', cost: 2000 }, { transport_type: 'metro', cost: 800 }],
    });
    const d = store.draftFromRoute(store.data.routes.get(rid));
    d.started_at = BASE;
    d.finished_at = BASE + 45 * MINUTE;
    const id = await store.saveTrip(d);
    assert.equal(store.trip(id).route_id, rid);
    assert.equal(store.tripCost(store.trip(id)), 2800);
  });

  test('удаление истории геолокации', async () => {
    const store = await makeStore();
    await store.startTrip({ tripId: 't', direction: 'to_work', mode: 'gps', startedAt: BASE, pauses: [] });
    await store.addTrackPoints('t', [{ t: BASE, lat: 50.45, lon: 30.52, acc: 10 }, { t: BASE + 60_000, lat: 50.451, lon: 30.52, acc: 10 }]);
    await store.recordInspection('t', 'ticket_checked', BASE + 60_000, { lat: 50.45, lon: 30.52 });
    await store.deleteLocationHistory();
    assert.equal(store.trackOf('t').length, 0);
    assert.equal(store.inspectionsOf('t')[0].location_latitude, null);
    assert.equal(store.inspectionsOf('t').length, 1);
  });
});

// ------------------------------------------------------------------ фейковый Supabase

function fakeSupabase() {
  const tables = { locations: new Map(), routes: new Map(), trips: new Map(), trip_segments: new Map(), inspections: new Map() };
  let online = true;
  const users = new Map();
  const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
  const fetchFn = async (url, init = {}) => {
    if (!online) throw new TypeError('Failed to fetch');
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    if (u.pathname === '/auth/v1/signup' || u.pathname === '/auth/v1/token') {
      const email = body.email ?? 'a@test';
      if (!users.has(email)) users.set(email, crypto.randomUUID());
      return json(200, { access_token: 'tok', refresh_token: 'ref', expires_in: 3600, user: { id: users.get(email), email } });
    }
    const table = u.pathname.replace('/rest/v1/', '');
    if (init.method === 'POST') {
      for (const row of body) {
        const old = tables[table].get(row.id);
        if (old && old.user_id !== row.user_id) return json(403, { message: 'RLS' });
        if (old && Date.parse(row.updated_at) < Date.parse(old.updated_at)) continue; // LWW-триггер
        tables[table].set(row.id, row);
      }
      return json(201, null);
    }
    const gt = u.searchParams.get('updated_at')?.replace('gt.', '');
    const rows = [...tables[table].values()]
      .filter((r) => !gt || Date.parse(r.updated_at) > Date.parse(gt))
      .sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at));
    return json(200, rows);
  };
  return { tables, fetchFn, setOnline: (v) => { online = v; }, isOnline: () => online };
}

const memoryStorage = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
};

describe('Синхронизация', () => {
  test('оффлайн → очередь сохраняется → отправка после восстановления сети', async () => {
    const server = fakeSupabase();
    const store = await makeStore();
    const client = new SupabaseClient({ url: 'https://x.supabase.co', anonKey: 'anon' }, memoryStorage(), server.fetchFn);
    await client.signIn('a@test', 'pw');
    const sync = new SyncManager(store, client, { online: server.isOnline, clock });

    server.setOnline(false);
    const id = await store.saveTrip(draft(store));
    await sync.request();
    assert.equal(sync.status.state, 'offline');
    assert.equal(store.queue().length, 4);

    server.setOnline(true);
    await sync.request();
    assert.equal(sync.status.state, 'idle');
    assert.equal(store.queue().length, 0);
    assert.equal(server.tables.trips.get(id).total_cost, 2800);
    assert.equal(server.tables.trip_segments.size, 2);
    assert.equal(server.tables.inspections.size, 1);
  });

  test('второе устройство получает поездку, правки и удаление', async () => {
    const server = fakeSupabase();
    const a = await makeStore();
    const b = await makeStore();
    const ca = new SupabaseClient({ url: 'https://x.supabase.co', anonKey: 'anon' }, memoryStorage(), server.fetchFn);
    const cb = new SupabaseClient({ url: 'https://x.supabase.co', anonKey: 'anon' }, memoryStorage(), server.fetchFn);
    await ca.signIn('a@test', 'pw');
    await cb.signIn('a@test', 'pw');
    const sa = new SyncManager(a, ca, { online: () => true, clock });
    const sb = new SyncManager(b, cb, { online: () => true, clock });

    const d = draft(a);
    d.extra_cost = 500;
    const id = await a.saveTrip(d);
    await sa.request();
    await sb.request();
    assert.equal(b.tripCost(b.trip(id)), 3300); // этапы + «без разбивки»
    assert.equal(b.inspectionsOf(id).length, 1);

    clockNow += 60_000;
    const edit = b.draftFromTrip(b.trip(id));
    edit.comment = 'пробка';
    await b.saveTrip(edit);
    await sb.request();
    await sa.request();
    assert.equal(a.trip(id).comment, 'пробка');

    clockNow += 60_000;
    await a.deleteTrip(id);
    await sa.request();
    await sb.request();
    assert.equal(b.liveTrips().length, 0);
  });

  test('устаревшая правка не перетирает новую', async () => {
    const server = fakeSupabase();
    const store = await makeStore();
    const client = new SupabaseClient({ url: 'https://x.supabase.co', anonKey: 'anon' }, memoryStorage(), server.fetchFn);
    await client.signIn('a@test', 'pw');
    const id = await store.saveTrip(draft(store));
    const row = toRemote('trips', store.trip(id), client.user.id, store);
    await client.upsert('trips', [{ ...row, comment: 'новое', updated_at: new Date(clockNow + 3_600_000).toISOString() }]);
    const sync = new SyncManager(store, client, { online: () => true, clock });
    await sync.request(); // локальная (старая) версия отправлена, но сервер оставил новую
    assert.equal(server.tables.trips.get(id).comment, 'новое');
    assert.equal(store.trip(id).comment, 'новое'); // и она пришла обратно
  });

  test('без входа — данные остаются локально', async () => {
    const server = fakeSupabase();
    const store = await makeStore();
    const client = new SupabaseClient({ url: 'https://x.supabase.co', anonKey: 'anon' }, memoryStorage(), server.fetchFn);
    const sync = new SyncManager(store, client, { online: () => true, clock });
    await store.saveTrip(draft(store));
    await sync.request();
    assert.equal(sync.status.state, 'signedOut');
    assert.equal(store.queue().length, 4);
  });

  test('преобразование строк туда и обратно', async () => {
    const store = await makeStore();
    const id = await store.saveTrip(draft(store));
    const remote = toRemote('trips', store.trip(id), 'u1', store);
    assert.equal(remote.duration_seconds, 45 * 60);
    assert.equal(remote.started_at, new Date(BASE).toISOString());
    const back = fromRemote('trips', remote);
    assert.equal(back.started_at, BASE);
    assert.equal(back.remote_total_cost, 2800);
    assert.equal(back.user_id, undefined);
  });
});

// ------------------------------------------------------------------ правка этапов в пути
import { test as t2 } from 'node:test';
import assert2 from 'node:assert/strict';
import { Store as Store2 } from '../src/data/store.js';
import { MemoryBackend as Mem2 } from '../src/data/db.js';

t2('правка и удаление этапа в пути: соседние этапы остаются встык', async () => {
  const MIN = 60_000;
  let now = Date.parse('2026-11-04T07:00:00Z');
  const store = new Store2(new Mem2(), { clock: () => now, timeZone: 'Europe/Kyiv' });
  await store.load();
  const t0 = now;
  await store.startTrip({ tripId: 'tr', direction: 'to_work', mode: 'manual', startedAt: t0 });
  await store.appendLiveSegment('tr', { transport_type: 'walk' }, t0);
  now = t0 + 10 * MIN;
  await store.appendLiveSegment('tr', { transport_type: 'bus', cost: 1500 }, now);
  now = t0 + 30 * MIN;
  await store.appendLiveSegment('tr', { transport_type: 'metro', cost: 800 }, now);
  await store.recordInspection('tr', 'ticket_checked', now);
  now = t0 + 40 * MIN;
  const [walk, bus, metro] = store.segmentsOf('tr');

  // транспорт, номер, цена и время начала автобуса; конец пешего этапа следует за ним
  await store.updateLiveSegment(bus.id, { transport_type: 'minibus', transport_number: ' 720 ', cost: 2000, started_at: t0 + 12 * MIN });
  const [w1, b1] = store.segmentsOf('tr');
  assert2.equal(b1.transport_type, 'minibus');
  assert2.equal(b1.transport_number, '720');
  assert2.equal(b1.cost, 2000);
  assert2.equal(b1.started_at, t0 + 12 * MIN);
  assert2.equal(w1.finished_at, t0 + 12 * MIN);
  assert2.equal(store.tripCost(store.trip('tr')), 2800);

  await assert2.rejects(store.updateLiveSegment(bus.id, { started_at: t0 - MIN }), /раньше предыдущего/);
  await assert2.rejects(store.updateLiveSegment(bus.id, { started_at: t0 + 35 * MIN }), /позже следующего/);
  await assert2.rejects(store.updateLiveSegment(metro.id, { started_at: t0 + 50 * MIN }), /не наступило/);
  await assert2.rejects(store.updateLiveSegment(bus.id, { cost: -1 }), /отрицательной/);

  // удаление последнего этапа: предыдущий снова текущий, отметка контролёра удалена
  await store.deleteLiveSegment(metro.id);
  const after = store.segmentsOf('tr');
  assert2.deepEqual(after.map((x) => x.transport_type), ['walk', 'minibus']);
  assert2.equal(after[1].finished_at, null);
  assert2.equal(store.inspectionsOf('tr').length, 0);

  // удаление среднего: время отходит предыдущему, позиции без дыр
  await store.appendLiveSegment('tr', { transport_type: 'tram', cost: 800 }, now);
  await store.deleteLiveSegment(b1.id);
  const left = store.segmentsOf('tr');
  assert2.deepEqual(left.map((x) => [x.transport_type, x.position]), [['walk', 0], ['tram', 1]]);
  assert2.equal(left[0].finished_at, now);
  assert2.ok(store.queue().some((op) => op.entityId === b1.id && op.kind === 'delete'));
  void walk;
});
