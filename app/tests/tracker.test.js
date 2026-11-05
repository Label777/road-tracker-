// Запись поездки: поездка сохраняется в историю до того, как запись считается оконченной.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Tracker } from '../src/ui/tracker.js';
import { Store } from '../src/data/store.js';
import { MemoryBackend } from '../src/data/db.js';

const MIN = 60_000;

async function setup(backend = new MemoryBackend()) {
  let now = Date.parse('2026-11-04T17:00:00Z');
  const clock = () => now;
  const store = new Store(backend, { clock, timeZone: 'Europe/Kyiv' });
  await store.load();
  const tracker = new Tracker(store, { geolocation: null, clock });
  return { store, tracker, backend, tick: (ms) => { now += ms; } };
}

test('«Завершить»: поездка в истории, запись окончена', async () => {
  const { store, tracker, tick } = await setup();
  await tracker.send({ type: 'start', direction: 'to_home', mode: 'manual' });
  const id = tracker.session.tripId;
  tick(40 * MIN);
  await tracker.send({ type: 'finish' });
  assert.equal(tracker.session, null);
  assert.equal(store.trip(id).status, 'completed');
  assert.equal(store.completedSummaries().length, 1);
});

test('сохранение не удалось — запись не теряется, поездку можно завершить ещё раз', async () => {
  const { store, tracker, tick } = await setup();
  await tracker.send({ type: 'start', direction: 'to_home', mode: 'manual' });
  const id = tracker.session.tripId;
  tick(40 * MIN);
  const real = store.finishTrip.bind(store);
  store.finishTrip = async () => { throw new Error('диск недоступен'); };
  await tracker.send({ type: 'finish' });
  assert.equal(tracker.session?.tripId, id, 'запись продолжается');
  assert.equal(store.meta('tracking').status, 'recording', 'и после перезагрузки тоже');
  store.finishTrip = real;
  await tracker.send({ type: 'finish' });
  assert.equal(store.trip(id).status, 'completed');
});

test('после перезагрузки: запись, чья поездка уже сохранена или удалена, закрывается', async () => {
  const backend = new MemoryBackend();
  const a = await setup(backend);
  await a.tracker.send({ type: 'start', direction: 'to_work', mode: 'manual' });
  const id = a.tracker.session.tripId;
  await a.store.deleteTrip(id);
  const b = await setup(backend);
  assert.equal(b.tracker.session, null);
});

test('прерванную поездку видно и её можно вернуть из «Недавно удалённых»', async () => {
  const { store, tracker, tick } = await setup();
  await tracker.send({ type: 'start', direction: 'to_work', mode: 'manual' });
  const id = tracker.session.tripId;
  await store.appendLiveSegment(id, { transport_type: 'bus', cost: 1500 }, Date.parse('2026-11-04T17:00:00Z'));
  tick(30 * MIN);
  await tracker.send({ type: 'cancel' });
  assert.equal(store.trip(id).deleted_at != null, true);
  assert.deepEqual(store.deletedTrips().map((t) => t.id), [id]);
  await store.restoreTrip(id);
  assert.equal(store.trip(id).deleted_at, null);
  assert.equal(store.tripCost(store.trip(id)), 1500, 'этапы вернулись вместе с поездкой');
  assert.deepEqual(store.unfinishedTrips().map((t) => t.id), [id], 'вернулась как незавершённая — её видно в истории');
});
