// Подсказки из истории пользователя: частые стоимости, номера маршрутов, цепочки этапов.
// Только реальные данные; если истории нет — подсказок нет.

const tally = (items) => {
  const m = new Map();
  for (const x of items) m.set(x, (m.get(x) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).map(([x]) => x);
};

/** Частые стоимости этапов данного транспорта (копейки). */
export function frequentCosts(store, transport = null, limit = 4) {
  const costs = store.live('trip_segments')
    .filter((s) => s.cost > 0 && (!transport || s.transport_type === transport))
    .map((s) => s.cost);
  return tally(costs).slice(0, limit);
}

/** Частые стоимости поездок целиком (для быстрого добавления). */
export function frequentTripCosts(store, limit = 4) {
  return tally(store.liveTrips().filter((t) => t.status === 'completed').map((t) => store.tripCost(t)).filter((c) => c > 0)).slice(0, limit);
}

/** Номера маршрутов по префиксу, с видом транспорта. */
export function routeNumbers(store, prefix = '', limit = 5) {
  const p = prefix.trim().toLowerCase();
  const items = store.live('trip_segments').filter((s) => s.transport_number)
    .map((s) => `${s.transport_type}|${s.transport_number}`);
  for (const r of store.live('routes')) for (const s of r.segments) if (s.transport_number) items.push(`${s.transport_type}|${s.transport_number}`);
  return tally(items).map((k) => {
    const [transport_type, transport_number] = k.split('|');
    return { transport_type, transport_number };
  }).filter((x) => !p || x.transport_number.toLowerCase().startsWith(p)).slice(0, limit);
}

/** Последняя завершённая поездка в направлении (для «как в прошлый раз»). */
export function lastTrip(store, direction = null) {
  return store.liveTrips().find((t) => t.status === 'completed' && (!direction || t.direction === direction)) ?? null;
}
