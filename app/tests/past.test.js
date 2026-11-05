// «Прошлая поездка» по этапам.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPastTrip, stagesFrom, parseDateInput, parseTimeInput, timeInput } from '../src/core/past.js';
import { zonedTime, MINUTE } from '../src/core/time.js';

const TZ = 'Europe/Kyiv';
const now = zonedTime(2026, 11, 5, 8, 5, TZ);

test('этапы идут встык от выезда, у каждого своё время', () => {
  const r = buildPastTrip({
    date: { y: 2026, m: 11, d: 4 }, startMinute: 8 * 60 + 10, tz: TZ, now,
    stages: [
      { transport_type: 'walk', cost: 0, minutes: 8 },
      { transport_type: 'minibus', transport_number: '720', cost: 2000, minutes: 25 },
      { transport_type: 'metro', cost: 800, minutes: 12 },
    ],
  });
  assert.equal(r.started_at, zonedTime(2026, 11, 4, 8, 10, TZ));
  assert.equal(r.finished_at, zonedTime(2026, 11, 4, 8, 55, TZ));
  assert.deepEqual(r.segments.map((s) => [(s.started_at - r.started_at) / MINUTE, (s.finished_at - r.started_at) / MINUTE]), [[0, 8], [8, 33], [33, 45]]);
  assert.equal(r.segments[1].transport_number, '720');
});

test('ошибки: нет этапов, нет минут, отрицательная цена, поездка в будущем', () => {
  const base = { date: { y: 2026, m: 11, d: 4 }, startMinute: 480, tz: TZ, now };
  assert.throws(() => buildPastTrip({ ...base, stages: [] }), /хотя бы один этап/);
  assert.throws(() => buildPastTrip({ ...base, stages: [{ transport_type: 'bus', cost: 0, minutes: null }] }), /Этап 1: укажите/);
  assert.throws(() => buildPastTrip({ ...base, stages: [{ transport_type: 'bus', cost: -5, minutes: 5 }] }), /отрицательной/);
  assert.throws(() => buildPastTrip({ ...base, date: { y: 2026, m: 11, d: 5 }, stages: [{ transport_type: 'bus', cost: 0, minutes: 30 }] }), /в будущем/);
});

test('образец из прошлой поездки: минуты по времени этапов или поровну', () => {
  const t0 = zonedTime(2026, 11, 3, 8, 0, TZ);
  const trip = { started_at: t0, finished_at: t0 + 45 * MINUTE };
  const timed = [
    { transport_type: 'walk', cost: 0, started_at: t0, finished_at: t0 + 10 * MINUTE },
    { transport_type: 'bus', transport_number: '7', cost: 1500, started_at: t0 + 10 * MINUTE, finished_at: t0 + 45 * MINUTE },
  ];
  assert.deepEqual(stagesFrom(trip, timed).map((s) => s.minutes), [10, 35]);
  const untimed = timed.map((s) => ({ ...s, started_at: null, finished_at: null }));
  assert.deepEqual(stagesFrom(trip, untimed).map((s) => s.minutes), [23, 22]);
  assert.equal(stagesFrom(trip, timed)[1].transport_number, '7');
});

test('поля даты и времени', () => {
  assert.deepEqual(parseDateInput('2026-11-04'), { y: 2026, m: 11, d: 4 });
  assert.equal(parseDateInput(''), null);
  assert.equal(parseTimeInput('08:10'), 490);
  assert.equal(parseTimeInput('25:00'), null);
  assert.equal(timeInput(490), '08:10');
});
