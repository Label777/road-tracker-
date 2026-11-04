// Цвета транспорта: CSS и JS согласованы, линия трека делится по этапам.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TRANSPORT, TRANSPORT_COLORS, TRANSPORT_ICONS } from '../src/ui/format.js';
import { trackRuns } from '../src/core/geo.js';

test('у каждого вида транспорта свой цвет, одинаковый в CSS и для карты', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const kinds = Object.keys(TRANSPORT);
  assert.deepEqual(Object.keys(TRANSPORT_COLORS).sort(), [...kinds].sort());
  assert.equal(new Set(Object.values(TRANSPORT_COLORS)).size, kinds.length, 'цвета не повторяются');
  for (const k of kinds) {
    const m = css.match(new RegExp(`^\\.tr-${k} \\{ --tr: (#[0-9a-f]{6}); \\}|\\s\\.tr-${k} \\{ --tr: (#[0-9a-f]{6}); \\}`, 'm'));
    assert.ok(m, `в CSS нет .tr-${k}`);
    assert.equal(m[1] ?? m[2], TRANSPORT_COLORS[k], k);
    assert.match(String(TRANSPORT_ICONS[k]), new RegExp(`class="tr-icon tr-${k}"`));
  }
});

test('трек делится на участки по этапам без разрывов', () => {
  const p = (t) => ({ t, lat: 50 + t / 1e6, lon: 30, acc: 5 });
  const track = [p(0), p(10), p(20), p(30), p(40), p(50)];
  const segs = [
    { transport_type: 'walk', started_at: 10, finished_at: 25 },
    { transport_type: 'bus', started_at: 25, finished_at: null },
  ];
  const runs = trackRuns(track, segs);
  assert.deepEqual(runs.map((r) => r.type), [null, 'walk', 'bus']);
  assert.deepEqual(runs.map((r) => r.points.map((x) => x.t)), [[0], [0, 10, 20], [20, 30, 40, 50]]);
  assert.deepEqual(trackRuns(track, []).map((r) => r.type), [null]);
});
