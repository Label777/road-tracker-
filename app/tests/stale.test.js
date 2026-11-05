// Забытая запись: когда предлагать завершить и в какое время.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { staleTrip } from '../src/core/stale.js';
import { zonedTime, MINUTE, HOUR } from '../src/core/time.js';
import { Store } from '../src/data/store.js';
import { MemoryBackend } from '../src/data/db.js';

const TZ = 'Europe/Kyiv';
const start = zonedTime(2026, 11, 4, 18, 57, TZ);

test('обычная поездка — не «забытая»; через ночь или в 3 раза дольше обычного — да', () => {
  assert.equal(staleTrip({ startedAt: start }, { now: start + 50 * MINUTE, tz: TZ }), null);
  assert.equal(staleTrip({ startedAt: start }, { now: start + 2.5 * HOUR, usualMs: 50 * MINUTE, tz: TZ }), null);
  assert.ok(staleTrip({ startedAt: start }, { now: start + 3.1 * HOUR, usualMs: 50 * MINUTE, tz: TZ }));
  const morning = zonedTime(2026, 11, 5, 8, 5, TZ);
  const s = staleTrip({ startedAt: start }, { now: morning, tz: TZ });
  assert.ok(s.activeFor > 13 * HOUR);
});

test('время окончания: обычная длительность, иначе последняя отметка, иначе 45 минут', () => {
  const now = zonedTime(2026, 11, 5, 8, 5, TZ);
  assert.deepEqual(staleTrip({ startedAt: start }, { now, usualMs: 52 * MINUTE, lastActivity: start + 20 * MINUTE, tz: TZ }),
    { activeFor: now - start, suggestedEnd: start + 52 * MINUTE, basis: 'usual' });
  // последняя отметка позже обычной длительности — по ней
  const r = staleTrip({ startedAt: start }, { now, usualMs: 30 * MINUTE, lastActivity: start + 40 * MINUTE, tz: TZ });
  assert.equal(r.basis, 'activity');
  assert.equal(r.suggestedEnd, start + 45 * MINUTE);
  assert.equal(staleTrip({ startedAt: start }, { now, tz: TZ }).suggestedEnd, start + 45 * MINUTE);
});

test('завершение задним числом: этап закрывается этим временем, лишние точки трека удаляются', async () => {
  let now = start;
  const store = new Store(new MemoryBackend(), { clock: () => now, timeZone: TZ });
  await store.load();
  await store.startTrip({ tripId: 'x', direction: 'to_home', mode: 'gps', startedAt: start });
  await store.appendLiveSegment('x', { transport_type: 'minibus', cost: 2000 }, start);
  await store.addTrackPoints('x', [10, 20, 600].map((m) => ({ t: start + m * MINUTE, lat: 50 + m / 1e4, lon: 30, acc: 5 })));
  now = zonedTime(2026, 11, 5, 8, 5, TZ);
  const end = start + 50 * MINUTE;
  await store.finishTrip({ tripId: 'x', pauses: [], mode: 'gps' }, end);
  const t = store.trip('x');
  assert.equal(t.status, 'completed');
  assert.equal(t.finished_at, end);
  assert.equal(store.segmentsOf('x')[0].finished_at, end);
  assert.equal(store.trackOf('x').length, 2);
  assert.equal(store.completedSummaries()[0].activeMs, 50 * MINUTE);
});
