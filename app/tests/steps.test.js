// Расстояние по этапам и шаги: датчик, оценки, хранилище, аналитика.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { segmentDistances } from '../src/core/geo.js';
import { createStepDetector, segmentSteps, tripSteps, strideFromHeight, DEFAULT_STRIDE_M, healthRanges, healthInput, parseHealthResult } from '../src/core/steps.js';
import { movementTotals } from '../src/core/analytics.js';
import { Store } from '../src/data/store.js';
import { MemoryBackend } from '../src/data/db.js';
import { toRemote } from '../src/data/sync.js';
import { formatSteps, formatDistance, plural } from '../src/ui/format.js';

const MIN = 60_000;
// Точка в ~111 м к северу на каждые 0,001°
const pt = (t, north) => ({ t, lat: 50 + north * 0.001, lon: 30.5, acc: 5 });

/** Синтетический акселерометр: 50 Гц, шаги — синус с частотой f, плюс шум. */
function simulate(detector, { seconds, f = 0, amp = 0, noise = 0.15, jitterHz = 0, jitterAmp = 0, seed = 1 }) {
  let r = seed;
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  let steps = 0;
  for (let i = 0; i < seconds * 50; i++) {
    const t = i * 20;
    const z = 9.81 + amp * Math.sin(2 * Math.PI * f * (t / 1000)) + jitterAmp * Math.sin(2 * Math.PI * jitterHz * (t / 1000)) + noise * rnd();
    steps += detector.push(t, 0.2 * rnd(), 0.2 * rnd(), z);
  }
  return steps;
}

describe('Датчик шагов', () => {
  test('ходьба ~2 шага в секунду: 60 секунд ≈ 120 шагов', () => {
    const n = simulate(createStepDetector(), { seconds: 60, f: 1.9, amp: 3 });
    assert.ok(Math.abs(n - 114) <= 4, `насчитано ${n}`);
  });

  test('тряска в транспорте и одиночный толчок — не шаги', () => {
    assert.equal(simulate(createStepDetector(), { seconds: 60, jitterHz: 14, jitterAmp: 0.6, noise: 0.3 }), 0);
    const d = createStepDetector();
    let n = 0;
    for (let i = 0; i < 500; i++) n += d.push(i * 20, 0, 0, 9.81 + (i === 200 ? 8 : 0));
    assert.equal(n, 0);
  });

  test('после паузы серия начинается заново и короткие серии не засчитываются', () => {
    const d = createStepDetector();
    simulate(d, { seconds: 1.2, f: 2, amp: 3 }); // 2 шага — меньше серии из 4
    assert.equal(simulate(d, { seconds: 1.2, f: 2, amp: 3, seed: 7 }) <= 4, true);
  });
});

describe('Оценка шагов', () => {
  test('длина шага по росту', () => {
    assert.equal(strideFromHeight(180), 0.75);
    assert.equal(strideFromHeight(160), 0.66);
    assert.equal(strideFromHeight(null), DEFAULT_STRIDE_M);
    assert.equal(strideFromHeight(300), DEFAULT_STRIDE_M);
  });

  test('датчик → расстояние → время; не пешком — без шагов', () => {
    const walk = { transport_type: 'walk', started_at: 0, finished_at: 10 * MIN, distance_meters: 720, steps: null };
    assert.deepEqual(segmentSteps({ ...walk, steps: 950 }), { steps: 950, source: 'sensor' });
    assert.deepEqual(segmentSteps(walk), { steps: 1000, source: 'distance' });
    assert.deepEqual(segmentSteps({ ...walk, distance_meters: null }), { steps: 1000, source: 'time' });
    assert.equal(segmentSteps({ ...walk, transport_type: 'bus' }), null);
    assert.equal(segmentSteps({ transport_type: 'walk', started_at: null, finished_at: null }), null);
    const total = tripSteps([{ ...walk, steps: 500 }, walk, { ...walk, transport_type: 'metro' }]);
    assert.deepEqual(total, { steps: 1500, source: 'distance' });
  });

  test('подписи', () => {
    assert.equal(formatSteps(1, 'sensor'), '1 шаг');
    assert.equal(formatSteps(3, 'sensor'), '3 шага');
    assert.equal(formatSteps(12, 'sensor'), '12 шагов');
    assert.equal(formatSteps(1021, 'distance').replace(/\s/g, ' '), '≈1 021 шаг');
    assert.equal(plural(22, 'a', 'b', 'c'), 'b');
    assert.equal(formatDistance(642), '640 м');
    assert.equal(formatDistance(2450), '2,5 км');
  });
});

describe('Расстояние по этапам', () => {
  test('трек делится по времени этапов, точка пересадки входит в оба', () => {
    const track = [pt(0, 0), pt(MIN, 1), pt(2 * MIN, 2), pt(3 * MIN, 5), pt(4 * MIN, 10)];
    const segs = [
      { id: 'walk', started_at: 0, finished_at: 2 * MIN },
      { id: 'bus', started_at: 2 * MIN, finished_at: null },
      { id: 'no-time', started_at: null },
    ];
    const d = segmentDistances(track, segs, 4 * MIN);
    assert.ok(Math.abs(d.get('walk') - 222) <= 2, `пешком ${d.get('walk')}`);
    assert.ok(Math.abs(d.get('bus') - 890) <= 3, `автобус ${d.get('bus')}`);
    assert.equal(d.has('no-time'), false);
  });

  test('хранилище: расстояние этапов при пересадке и завершении, шаги в сводке', async () => {
    let now = Date.parse('2026-11-04T07:00:00Z');
    const store = new Store(new MemoryBackend(), { clock: () => now, timeZone: 'Europe/Kyiv' });
    await store.load();
    const tripId = 'trip-steps';
    await store.startTrip({ tripId, direction: 'to_work', mode: 'gps', startedAt: now });
    const t0 = now;
    await store.appendLiveSegment(tripId, { transport_type: 'walk', cost: 0 }, t0);
    await store.addTrackPoints(tripId, [0, 1, 2].map((k) => pt(t0 + k * MIN, k)));
    now = t0 + 2 * MIN;
    await store.appendLiveSegment(tripId, { transport_type: 'bus', cost: 1500 }, now);
    const [walk] = store.segmentsOf(tripId);
    assert.ok(Math.abs(walk.distance_meters - 222) <= 2, 'пеший этап получил расстояние при пересадке');
    await store.addTrackPoints(tripId, [3, 4].map((k) => pt(t0 + (k + 1) * MIN, k * 3)));
    now = t0 + 6 * MIN;
    await store.finishTrip({ tripId, pauses: [], mode: 'gps' }, now);
    const [, bus] = store.segmentsOf(tripId);
    assert.ok(bus.distance_meters > 1000, `автобус ${bus.distance_meters}`);
    assert.ok(store.trip(tripId).distance_meters > 1200);

    await store.setSegmentSteps(walk.id, 300);
    assert.deepEqual(store.walkOf(store.trip(tripId)), { meters: walk.distance_meters, steps: 300, source: 'sensor' });
    assert.equal(toRemote('trip_segments', store.data.trip_segments.get(walk.id), store).steps, 300);
    assert.equal('steps' in toRemote('trip_segments', store.data.trip_segments.get(bus.id), store), false, 'без шагов поле не отправляется');

    await store.setMeta('settings', { heightCm: 180 });
    await store.setSegmentSteps(walk.id, null);
    const s = store.completedSummaries()[0];
    assert.equal(s.walk.source, 'distance');
    assert.equal(s.walk.steps, Math.round(walk.distance_meters / 0.75));
    const m = movementTotals(store.completedSummaries());
    assert.equal(m.walkTrips, 1);
    assert.equal(m.estimated, true);
    assert.ok(m.gpsMeters > 1200);
  });
});

describe('Шаги из «Здоровья»', () => {
  const now = Date.parse('2026-11-04T17:00:00Z');
  const segs = [
    { id: 'w1', transport_type: 'walk', started_at: now - 95 * MIN, finished_at: now - 80 * MIN + 30_000 },
    { id: 'b', transport_type: 'bus', started_at: now - 80 * MIN, finished_at: now - 41 * MIN },
    { id: 'w2', transport_type: 'walk', started_at: now - 40 * MIN - 20_000, finished_at: now - 30 * MIN },
    { id: 'w3', transport_type: 'walk', started_at: null, finished_at: null },
  ];

  test('интервалы пеших этапов в минутах назад (с запасом наружу)', () => {
    const r = healthRanges(segs, now);
    assert.deepEqual(r, [{ id: 'w1', fromMin: 95, toMin: 79 }, { id: 'w2', fromMin: 41, toMin: 30 }]);
    assert.equal(healthInput(r), '95|79;41|30');
  });

  test('ответ команды: числа в любом формате, пустое значение — 0', () => {
    const r = healthRanges(segs, now);
    assert.deepEqual([...parseHealthResult('820;410', r)], [['w1', 820], ['w2', 410]]);
    assert.deepEqual([...parseHealthResult('1\u00a0234,0\n17.6', r).values()], [1234, 18]);
    assert.deepEqual([...parseHealthResult(';410', r).values()], [0, 410]);
    assert.throws(() => parseHealthResult('820', r), /1 значений вместо 2/);
    assert.throws(() => parseHealthResult('820;шаги', r), /«шаги»/);
    assert.throws(() => parseHealthResult(null, r), /ничего не вернула/);
  });
});
