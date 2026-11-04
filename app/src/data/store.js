// Локальная база — источник истины для интерфейса (local-first).
// Все записи в памяти; изменение и операция синхронизации фиксируются одной транзакцией.
// Формат записей совпадает с колонками Supabase (snake_case), время — миллисекунды.
import { activeDuration, deviceTimeZone, MINUTE } from '../core/time.js';
import { mergeOp, resolveConflict } from '../core/sync-policy.js';
import { validateTrip } from '../core/editing.js';
import { controllerPresent } from '../core/inspections.js';
import { trackDistance, segmentDistances } from '../core/geo.js';
import { tripSteps, strideFromHeight } from '../core/steps.js';
import { STORES } from './db.js';
import { BACKUP_TABLES } from '../core/backup.js';

export class StoreError extends Error {}

const SYNCED = { locations: 'locations', routes: 'routes', trips: 'trips', trip_segments: 'trip_segments', inspections: 'inspections' };
const trimOrNull = (s) => {
  const t = (s ?? '').toString().trim();
  return t === '' ? null : t;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Индексы «поездка → записи»: этапы, наблюдения и точки трека ищутся без перебора всей базы.
const BY_TRIP = ['trip_segments', 'inspections', 'track_points'];

class Tx {
  constructor(store) {
    this.store = store;
    this.writes = [];
    this.staged = new Map(); // `${store}:${key}` → value | null
  }
  get(name, id) {
    const k = `${name}:${id}`;
    if (this.staged.has(k)) return this.staged.get(k);
    return this.store.data[name].get(id) ?? null;
  }
  put(name, value) {
    const key = name === 'meta' ? value.key : value.id;
    this.staged.set(`${name}:${key}`, value);
    this.writes.push({ store: name, value });
  }
  del(name, key) {
    this.staged.set(`${name}:${key}`, null);
    this.writes.push({ store: name, key, delete: true });
  }
  /** Поставить запись в очередь отправки (схлопывая с уже ожидающей). */
  enqueue(entity, entityId, kind) {
    const now = this.store.clock();
    const id = `${entity}:${entityId}`;
    const incoming = { id, entity, entityId, kind, enqueuedAt: now, attempts: 0, nextAttemptAt: now, lastError: null };
    this.put('sync_queue', mergeOp(this.get('sync_queue', id), incoming));
  }
}

export class Store {
  /** @param {import('./db.js').Backend} backend */
  constructor(backend, { clock = () => Date.now(), newId = () => crypto.randomUUID(), timeZone = deviceTimeZone() } = {}) {
    this.backend = backend;
    this.clock = clock;
    this.newId = newId;
    this.timeZone = timeZone;
    this.data = Object.fromEntries(STORES.map((s) => [s, new Map()]));
    this.byTrip = Object.fromEntries(BY_TRIP.map((s) => [s, new Map()]));
    this.listeners = new Set();
    /** Ревизия данных: растёт при каждом изменении; по ней кэшируются сводки. */
    this.rev = 0;
    this.memo = new Map();
    this.memoRev = -1;
  }

  #indexAdd(name, row) {
    let m = this.byTrip[name].get(row.trip_id);
    if (!m) this.byTrip[name].set(row.trip_id, (m = new Map()));
    m.set(row.id, row);
  }

  #indexRemove(name, row) {
    const m = row && this.byTrip[name].get(row.trip_id);
    if (!m) return;
    m.delete(row.id);
    if (!m.size) this.byTrip[name].delete(row.trip_id);
  }

  /** Значение, вычисленное один раз на ревизию данных. */
  cached(key, fn) {
    if (this.memoRev !== this.rev) {
      this.memo.clear();
      this.memoRev = this.rev;
    }
    if (!this.memo.has(key)) this.memo.set(key, fn());
    return this.memo.get(key);
  }

  async load() {
    const all = await this.backend.loadAll();
    for (const s of STORES) {
      this.data[s] = new Map((all[s] || []).map((r) => [s === 'meta' ? r.key : r.id, r]));
    }
    for (const name of BY_TRIP) {
      this.byTrip[name] = new Map();
      for (const r of this.data[name].values()) this.#indexAdd(name, r);
    }
    this.rev++;
    this.emit();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn();
  }

  /** Выполнить изменение атомарно. Если запись на диск не удалась — память не меняется. */
  async transact(fn) {
    const tx = new Tx(this);
    const result = fn(tx);
    if (tx.writes.length) {
      await this.backend.commit(tx.writes);
      for (const w of tx.writes) {
        const key = w.delete ? w.key : (w.store === 'meta' ? w.value.key : w.value.id);
        if (this.byTrip[w.store]) this.#indexRemove(w.store, this.data[w.store].get(key));
        if (w.delete) this.data[w.store].delete(key);
        else {
          this.data[w.store].set(key, w.value);
          if (this.byTrip[w.store]) this.#indexAdd(w.store, w.value);
        }
      }
      this.rev++;
      this.emit();
    }
    return result;
  }

  // ------------------------------------------------------------------ чтение

  live(name) {
    return [...this.data[name].values()].filter((r) => !r.deleted_at);
  }

  trip(id) {
    return this.data.trips.get(id) ?? null;
  }

  liveTrips() {
    return this.cached('liveTrips', () => this.live('trips').sort((a, b) => b.started_at - a.started_at)).slice();
  }

  #ofTrip(name, tripId) {
    return [...(this.byTrip[name].get(tripId)?.values() ?? [])];
  }

  segmentsOf(tripId, tx = null) {
    const all = tx ? this.#merged(tx, 'trip_segments') : this.#ofTrip('trip_segments', tripId);
    return all.filter((s) => s.trip_id === tripId && !s.deleted_at).sort((a, b) => a.position - b.position);
  }

  inspectionsOf(tripId, tx = null) {
    const all = tx ? this.#merged(tx, 'inspections') : this.#ofTrip('inspections', tripId);
    return all.filter((i) => i.trip_id === tripId && !i.deleted_at);
  }

  trackOf(tripId) {
    return this.#ofTrip('track_points', tripId).sort((a, b) => a.t - b.t);
  }

  #merged(tx, name) {
    const map = new Map(this.data[name]);
    for (const [k, v] of tx.staged) {
      const [store, id] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
      if (store !== name) continue;
      if (v === null) map.delete(id);
      else map.set(id, v);
    }
    return [...map.values()];
  }

  tripCost(trip) {
    return (trip.extra_cost || 0) + this.segmentsOf(trip.id).reduce((a, s) => a + (s.cost || 0), 0);
  }

  tripActiveMs(trip, now = this.clock()) {
    const end = trip.finished_at ?? now;
    const fromPauses = activeDuration(trip.started_at, end, trip.pauses || []);
    const remotePaused = (trip.paused_seconds || 0) * 1000;
    return Math.max(0, Math.min(fromPauses, end - trip.started_at - remotePaused));
  }

  /** Плоская поездка для аналитики. */
  summary(trip) {
    return {
      id: trip.id,
      direction: trip.direction,
      startedAt: trip.started_at,
      finishedAt: trip.finished_at ?? trip.started_at,
      activeMs: this.tripActiveMs(trip),
      timeZone: trip.time_zone,
      segments: this.segmentsOf(trip.id).map((s) => ({ transport: s.transport_type, cost: s.cost, number: s.transport_number, distance: s.distance_meters })),
      distance: trip.distance_meters ?? null,
      walk: this.walkOf(trip),
      extraCost: trip.extra_cost || 0,
      controllers: this.inspectionsOf(trip.id).filter((i) => controllerPresent(i.outcome) === true).length,
      routeId: trip.route_id,
    };
  }

  /** Длина шага из настроек (рост) — для оценки шагов по расстоянию. */
  stride() {
    return strideFromHeight(this.meta('settings', {})?.heightCm);
  }

  /** Пешком в поездке: метры и шаги (с источником), или null, если пеших этапов нет. */
  walkOf(trip, { now = this.clock(), distances = null } = {}) {
    const walks = this.segmentsOf(trip.id).filter((s) => s.transport_type === 'walk');
    if (!walks.length) return null;
    const meters = walks.reduce((a, s) => a + (distances?.get(s.id) ?? s.distance_meters ?? 0), 0);
    return { meters: meters || null, ...(tripSteps(walks, { stride: this.stride(), now, distances }) ?? { steps: null, source: null }) };
  }

  /** Сводки завершённых поездок (новые первыми). Пересчитываются только после изменения данных. */
  completedSummaries() {
    return this.cached('summaries', () => this.liveTrips().filter((t) => t.status === 'completed').map((t) => this.summary(t)));
  }

  meta(key, fallback = null) {
    return this.data.meta.get(key)?.value ?? fallback;
  }

  async setMeta(key, value) {
    await this.transact((tx) => tx.put('meta', { key, value }));
  }

  queue() {
    return [...this.data.sync_queue.values()];
  }

  // ------------------------------------------------------------------ поездки

  async startTrip(session) {
    if (this.trip(session.tripId)) return;
    const now = this.clock();
    await this.transact((tx) => {
      tx.put('trips', {
        id: session.tripId, route_id: null, direction: session.direction, started_at: session.startedAt,
        finished_at: null, time_zone: this.timeZone, pauses: [], extra_cost: 0, distance_meters: null,
        tracking_mode: session.mode, status: 'active', comment: null,
        created_at: now, updated_at: now, deleted_at: null,
      });
      tx.enqueue('trips', session.tripId, 'upsert');
    });
  }

  async updateTrip(tripId, patch) {
    const trip = this.trip(tripId);
    if (!trip) return;
    const next = { ...trip, ...patch };
    if (same(trip, next)) return;
    await this.transact((tx) => {
      tx.put('trips', { ...next, updated_at: this.clock() });
      tx.enqueue('trips', tripId, 'upsert');
    });
  }

  async setPaused(tripId, paused, pauses) {
    await this.updateTrip(tripId, { status: paused ? 'paused' : 'active', pauses });
  }

  async finishTrip(session, end) {
    const trip = this.trip(session.tripId);
    if (!trip) return;
    const now = this.clock();
    const track = this.trackOf(trip.id);
    await this.transact((tx) => {
      const segments = this.segmentsOf(trip.id).map((seg, i, all) => (i === all.length - 1 && seg.finished_at == null
        ? { ...seg, finished_at: Math.max(end, seg.started_at ?? end) } : seg));
      // Расстояние каждого этапа — из трека, если пользователь не вводил его сам
      const dist = track.length > 1 ? segmentDistances(track, segments, end) : new Map();
      for (const seg of segments) {
        const prev = this.data.trip_segments.get(seg.id);
        const next = seg.distance_meters == null && dist.get(seg.id) > 0 ? { ...seg, distance_meters: dist.get(seg.id) } : seg;
        if (same(prev, next)) continue;
        tx.put('trip_segments', { ...next, updated_at: now });
        tx.enqueue('trip_segments', seg.id, 'upsert');
      }
      tx.put('trips', {
        ...trip, finished_at: end, pauses: session.pauses, status: 'completed', tracking_mode: session.mode,
        distance_meters: track.length > 1 ? Math.round(trackDistance(track)) : trip.distance_meters,
        updated_at: now,
      });
      tx.enqueue('trips', trip.id, 'upsert');
    });
  }

  async deleteTrip(tripId) {
    const trip = this.trip(tripId);
    if (!trip) return;
    const now = this.clock();
    await this.transact((tx) => {
      for (const s of this.segmentsOf(tripId)) {
        tx.put('trip_segments', { ...s, deleted_at: now, updated_at: now });
        tx.enqueue('trip_segments', s.id, 'delete');
      }
      for (const i of this.inspectionsOf(tripId)) {
        tx.put('inspections', { ...i, deleted_at: now, updated_at: now });
        tx.enqueue('inspections', i.id, 'delete');
      }
      // Трек — чувствительные данные и хранится только локально: удаляем сразу.
      for (const p of this.trackOf(tripId)) tx.del('track_points', p.id);
      tx.put('trips', { ...trip, deleted_at: now, updated_at: now });
      tx.enqueue('trips', tripId, 'delete');
    });
  }

  /** «Сел в транспорт»: закрывает открытый этап и открывает новый. */
  async appendLiveSegment(tripId, { transport_type, transport_number = null, cost = 0 }, at) {
    const trip = this.trip(tripId);
    if (!trip) return null;
    const now = this.clock();
    const id = this.newId();
    await this.transact((tx) => {
      const segments = this.segmentsOf(tripId);
      const open = segments.at(-1);
      if (open && open.finished_at == null) {
        const closed = { ...open, finished_at: at };
        const track = this.trackOf(tripId);
        if (closed.distance_meters == null && track.length > 1) {
          const d = segmentDistances(track, [closed], at).get(open.id);
          if (d > 0) closed.distance_meters = d;
        }
        tx.put('trip_segments', { ...closed, updated_at: now });
        tx.enqueue('trip_segments', open.id, 'upsert');
      }
      tx.put('trip_segments', {
        id, trip_id: tripId, position: segments.length, transport_type, transport_number: trimOrNull(transport_number),
        route_name: null, started_at: at, finished_at: null, cost, distance_meters: null, steps: null,
        transfer_number: segments.length, comment: null, created_at: now, updated_at: now, deleted_at: null,
      });
      tx.enqueue('trip_segments', id, 'upsert');
      tx.put('trips', { ...trip, updated_at: now });
      tx.enqueue('trips', tripId, 'upsert');
    });
    return id;
  }

  /** Шаги этапа по датчику движения (сохраняются периодически во время ходьбы). */
  async setSegmentSteps(segmentId, steps) {
    const seg = this.data.trip_segments.get(segmentId);
    if (!seg || seg.deleted_at || seg.steps === steps) return;
    await this.transact((tx) => {
      tx.put('trip_segments', { ...seg, steps, updated_at: this.clock() });
      tx.enqueue('trip_segments', segmentId, 'upsert');
    });
  }

  /** «Контролёр»: на текущем этапе (или на поездке без этапов). */
  async recordInspection(tripId, outcome, at, point = null) {
    if (!this.trip(tripId)) return;
    const segmentId = this.segmentsOf(tripId).at(-1)?.id ?? null;
    const existing = this.inspectionsOf(tripId).find((i) => i.segment_id === segmentId);
    const now = this.clock();
    await this.transact((tx) => {
      const id = existing?.id ?? this.newId();
      tx.put('inspections', {
        ...(existing || { id, trip_id: tripId, segment_id: segmentId, comment: null, created_at: now, deleted_at: null }),
        outcome, observed_at: at,
        location_latitude: point ? point.lat : existing?.location_latitude ?? null,
        location_longitude: point ? point.lon : existing?.location_longitude ?? null,
        updated_at: now,
      });
      tx.enqueue('inspections', id, 'upsert');
    });
  }

  async addTrackPoints(tripId, samples) {
    if (!samples.length) return;
    await this.transact((tx) => {
      for (const s of samples) {
        tx.put('track_points', { id: this.newId(), trip_id: tripId, t: s.t, lat: s.lat, lon: s.lon, acc: s.acc, speed: s.speed ?? -1 });
      }
    });
  }

  // ------------------------------------------------------------------ редактор поездки

  emptyDraft() {
    const now = this.clock();
    return {
      id: null, direction: 'to_work', started_at: now - 45 * MINUTE, finished_at: now, route_id: null,
      extra_cost: 0, comment: '', segments: [], trip_inspection: null, status: null,
    };
  }

  draftFromRoute(route) {
    const d = this.emptyDraft();
    d.direction = route.direction;
    d.route_id = route.id;
    d.segments = route.segments.map((s) => this.newSegmentDraft(s));
    return d;
  }

  newSegmentDraft(template = {}) {
    return {
      id: this.newId(), transport_type: template.transport_type || 'minibus',
      transport_number: template.transport_number || '', route_name: template.route_name || '',
      started_at: null, finished_at: null, cost: template.cost || 0, distance_meters: null, steps: null, comment: '', inspection: null,
    };
  }

  draftFromTrip(trip) {
    const inspections = this.inspectionsOf(trip.id);
    const insp = (i) => (i ? { id: i.id, outcome: i.outcome, observed_at: i.observed_at, comment: i.comment || '' } : null);
    return {
      id: trip.id, direction: trip.direction, started_at: trip.started_at, finished_at: trip.finished_at ?? this.clock(),
      route_id: trip.route_id, extra_cost: trip.extra_cost || 0, comment: trip.comment || '', status: trip.status,
      segments: this.segmentsOf(trip.id).map((s) => ({
        id: s.id, transport_type: s.transport_type, transport_number: s.transport_number || '', route_name: s.route_name || '',
        started_at: s.started_at, finished_at: s.finished_at, cost: s.cost, distance_meters: s.distance_meters,
        steps: s.steps ?? null, comment: s.comment || '', inspection: insp(inspections.find((i) => i.segment_id === s.id)),
      })),
      trip_inspection: insp(inspections.find((i) => i.segment_id == null)),
    };
  }

  draftIssues(d) {
    return validateTrip({
      start: d.started_at, end: d.finished_at, now: this.clock(),
      segments: d.segments.map((s) => ({ start: s.started_at, end: s.finished_at })),
    });
  }

  /**
   * Сохранить черновик поездки. Меняются и ставятся в очередь только реально изменённые записи:
   * лишнее обновление updated_at могло бы перетереть более свежую правку с другого устройства.
   */
  async saveTrip(d) {
    if (this.draftIssues(d).some((i) => i.blocking)) throw new StoreError('Проверьте время поездки и её этапов.');
    const now = this.clock();
    const existing = d.id ? this.trip(d.id) : null;
    const id = existing?.id ?? d.id ?? this.newId();
    await this.transact((tx) => {
      let tripChanged = false;
      const base = existing ?? {
        id, route_id: null, time_zone: this.timeZone, pauses: [], distance_meters: null, tracking_mode: 'manual',
        status: 'completed', created_at: now, deleted_at: null,
      };
      const ongoing = base.status === 'active' || base.status === 'paused';
      const next = {
        ...base, direction: d.direction, started_at: d.started_at,
        finished_at: ongoing ? base.finished_at : d.finished_at, route_id: d.route_id ?? null,
        extra_cost: d.extra_cost || 0, comment: trimOrNull(d.comment),
        status: base.status === 'suggested' ? 'completed' : base.status,
      };
      if (!existing || !same({ ...existing, updated_at: 0 }, { ...next, updated_at: 0 })) tripChanged = true;

      const keep = new Set(d.segments.map((s) => s.id));
      for (const s of this.segmentsOf(id)) {
        if (keep.has(s.id)) continue;
        tx.put('trip_segments', { ...s, deleted_at: now, updated_at: now });
        tx.enqueue('trip_segments', s.id, 'delete');
        for (const i of this.inspectionsOf(id).filter((i) => i.segment_id === s.id)) {
          tx.put('inspections', { ...i, deleted_at: now, updated_at: now });
          tx.enqueue('inspections', i.id, 'delete');
        }
        tripChanged = true;
      }

      d.segments.forEach((sd, index) => {
        const old = this.data.trip_segments.get(sd.id);
        const fields = {
          trip_id: id, position: index, transfer_number: index, transport_type: sd.transport_type,
          transport_number: trimOrNull(sd.transport_number), route_name: trimOrNull(sd.route_name),
          started_at: sd.started_at ?? null, finished_at: sd.finished_at ?? null, cost: sd.cost || 0,
          distance_meters: sd.distance_meters ?? null, comment: trimOrNull(sd.comment),
          steps: sd.transport_type === 'walk' ? sd.steps ?? null : null,
        };
        const live = old && !old.deleted_at ? old : null;
        if (!live || Object.keys(fields).some((k) => !same(live[k], fields[k]))) {
          tx.put('trip_segments', { ...(live || { id: sd.id, created_at: now, deleted_at: null }), ...fields, updated_at: now });
          tx.enqueue('trip_segments', sd.id, 'upsert');
          tripChanged = true;
        }
        this.#saveInspection(tx, id, sd.id, sd.inspection, now);
      });
      this.#saveInspection(tx, id, null, d.segments.length ? null : d.trip_inspection, now);

      if (tripChanged) {
        tx.put('trips', { ...next, updated_at: now });
        tx.enqueue('trips', id, 'upsert');
      }
    });
    return id;
  }

  #saveInspection(tx, tripId, segmentId, draft, now) {
    const existing = this.inspectionsOf(tripId).find((i) => (i.segment_id ?? null) === segmentId);
    const tomb = (i) => {
      tx.put('inspections', { ...i, deleted_at: now, updated_at: now });
      tx.enqueue('inspections', i.id, 'delete');
    };
    if (!draft) {
      if (existing && !tx.get('inspections', existing.id)?.deleted_at) tomb(existing);
      return;
    }
    const fields = { outcome: draft.outcome, observed_at: draft.observed_at, comment: trimOrNull(draft.comment) };
    if (existing && existing.id === draft.id) {
      if (Object.keys(fields).every((k) => same(existing[k], fields[k]))) return;
      tx.put('inspections', { ...existing, ...fields, updated_at: now });
      tx.enqueue('inspections', existing.id, 'upsert');
      return;
    }
    if (existing) tomb(existing);
    const id = draft.id || this.newId();
    tx.put('inspections', {
      id, trip_id: tripId, segment_id: segmentId, location_latitude: null, location_longitude: null,
      ...fields, created_at: now, updated_at: now, deleted_at: null,
    });
    tx.enqueue('inspections', id, 'upsert');
  }

  // ------------------------------------------------------------------ места и шаблоны

  async savePlace(p) {
    const name = (p.name || '').trim();
    if (!name || !(p.radius >= 100 && p.radius <= 2000) || !(Math.abs(p.latitude) <= 90) || !(Math.abs(p.longitude) <= 180)) {
      throw new StoreError('Укажите название места, координаты и радиус от 100 до 2000 м.');
    }
    const now = this.clock();
    const id = p.id || this.newId();
    await this.transact((tx) => {
      // Дом и Работа — по одному: прежний становится «другим местом».
      if (p.kind !== 'other') {
        for (const other of this.live('locations')) {
          if (other.kind === p.kind && other.id !== id) {
            tx.put('locations', { ...other, kind: 'other', updated_at: now });
            tx.enqueue('locations', other.id, 'upsert');
          }
        }
      }
      const old = this.data.locations.get(id);
      tx.put('locations', {
        ...(old || { id, created_at: now, deleted_at: null }),
        kind: p.kind, name, address: trimOrNull(p.address), latitude: +p.latitude, longitude: +p.longitude,
        radius: Math.round(p.radius), updated_at: now,
      });
      tx.enqueue('locations', id, 'upsert');
    });
    return id;
  }

  async deletePlace(id) {
    const p = this.data.locations.get(id);
    if (!p) return;
    const now = this.clock();
    await this.transact((tx) => {
      tx.put('locations', { ...p, deleted_at: now, updated_at: now });
      tx.enqueue('locations', id, 'delete');
    });
  }

  async saveRoute(r) {
    const name = (r.name || '').trim();
    if (!name || !r.segments.length || r.segments.length > 12) throw new StoreError('Укажите название маршрута и от 1 до 12 этапов.');
    const now = this.clock();
    const id = r.id || this.newId();
    await this.transact((tx) => {
      const old = this.data.routes.get(id);
      tx.put('routes', {
        ...(old || { id, created_at: now, deleted_at: null }),
        name, direction: r.direction, origin_id: r.origin_id || null, destination_id: r.destination_id || null,
        segments: r.segments.map((s) => ({
          transport_type: s.transport_type, transport_number: trimOrNull(s.transport_number),
          route_name: trimOrNull(s.route_name), cost: s.cost || 0,
        })),
        updated_at: now,
      });
      tx.enqueue('routes', id, 'upsert');
    });
    return id;
  }

  async deleteRoute(id) {
    const r = this.data.routes.get(id);
    if (!r) return;
    const now = this.clock();
    await this.transact((tx) => {
      tx.put('routes', { ...r, deleted_at: now, updated_at: now });
      tx.enqueue('routes', id, 'delete');
    });
  }

  // ------------------------------------------------------------------ приватность

  async deleteLocationHistory() {
    const now = this.clock();
    await this.transact((tx) => {
      for (const p of this.data.track_points.values()) tx.del('track_points', p.id);
      for (const i of this.data.inspections.values()) {
        if (i.location_latitude == null) continue;
        tx.put('inspections', { ...i, location_latitude: null, location_longitude: null, updated_at: now });
        tx.enqueue('inspections', i.id, 'upsert');
      }
    });
  }

  async purgeTrackPoints(days = 30) {
    const cutoff = this.clock() - days * 86_400_000;
    await this.transact((tx) => {
      for (const p of this.data.track_points.values()) if (p.t < cutoff) tx.del('track_points', p.id);
    });
  }

  async clearAll() {
    await this.backend.clear();
    for (const s of STORES) this.data[s] = new Map();
    for (const s of BY_TRIP) this.byTrip[s] = new Map();
    this.rev++;
    this.emit();
  }

  // ------------------------------------------------------------------ резервная копия

  /** Таблицы для резервной копии (без треков GPS). */
  backupTables() {
    return Object.fromEntries(BACKUP_TABLES.map((t) => [t, [...this.data[t].values()]]));
  }

  /**
   * Восстановить из копии. Запись из файла заменяет локальную, только если она новее
   * (как при синхронизации), поэтому повторное восстановление ничего не портит.
   * Незавершённые поездки из копии пропускаются: запись идёт только на одном устройстве.
   * Изменённые записи ставятся в очередь — при подключённом облаке уйдут и туда.
   */
  async importBackup({ tables, settings = null }) {
    const result = { added: 0, updated: 0, unchanged: 0 };
    const ongoing = new Set((tables.trips ?? []).filter((t) => t.status === 'active' || t.status === 'paused').map((t) => t.id));
    await this.transact((tx) => {
      for (const name of BACKUP_TABLES) {
        for (const row of tables[name] ?? []) {
          if (ongoing.has(name === 'trips' ? row.id : row.trip_id)) continue;
          const local = tx.get(name, row.id);
          if (local && (same(local, row) || resolveConflict(local, row) === 'local')) {
            result.unchanged++;
            continue;
          }
          result[local ? 'updated' : 'added']++;
          const value = name === 'trips' ? { pauses: [], ...row } : row;
          tx.put(name, value);
          tx.enqueue(name, row.id, row.deleted_at ? 'delete' : 'upsert');
        }
      }
      if (settings) tx.put('meta', { key: 'settings', value: { ...settings, ...this.meta('settings', {}) } });
    });
    return result;
  }

  // ------------------------------------------------------------------ для синхронизации

  /** Убрать операцию, если её не переставили новой правкой во время отправки. */
  async completeOps(sentOps) {
    await this.transact((tx) => {
      for (const op of sentOps) {
        const cur = this.data.sync_queue.get(op.id);
        if (cur && cur.nextAttemptAt === op.nextAttemptAt && cur.attempts === op.attempts) tx.del('sync_queue', op.id);
      }
    });
  }

  async updateOps(ops) {
    await this.transact((tx) => {
      for (const op of ops) if (this.data.sync_queue.has(op.id)) tx.put('sync_queue', op);
    });
  }

  /**
   * Применить строки с сервера (уже в локальном формате). Конфликт — last-write-wins.
   * @returns {Promise<number>} сколько записей изменилось локально
   */
  async applyRemote(table, rows) {
    if (!SYNCED[table]) throw new Error(`unknown table ${table}`);
    let changed = 0;
    await this.transact((tx) => {
      for (const remote of rows) {
        const local = this.data[table].get(remote.id);
        if (local && resolveConflict(local, remote) === 'local') continue;
        const merged = table === 'trips' && local ? { ...remote, pauses: local.pauses } : remote;
        if (local && same(local, merged)) continue;
        tx.put(table, merged);
        changed++;
      }
    });
    return changed;
  }
}
