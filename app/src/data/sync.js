// Синхронизация с Supabase через REST (PostgREST + GoTrue), без SDK.
// В клиенте только публичный anon key; доступ к строкам ограничивает RLS.
import { ENTITIES, readyOps, markFailed } from '../core/sync-policy.js';
import { mergedLength } from '../core/time.js';

const PULL_OVERLAP_MS = 24 * 3_600_000;
const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
const ms = (s) => (s == null ? null : Date.parse(s));

// ------------------------------------------------------------------ локальное ↔ сервер

/** Строка для сервера из локальной записи. */
export function toRemote(table, r, userId, store) {
  const common = { id: r.id, user_id: userId, updated_at: iso(r.updated_at), deleted_at: iso(r.deleted_at) };
  switch (table) {
    case 'locations':
      return { ...common, kind: r.kind, name: r.name, address: r.address, latitude: r.latitude, longitude: r.longitude, radius: r.radius };
    case 'routes':
      return {
        ...common, name: r.name, direction: r.direction, origin_id: r.origin_id, destination_id: r.destination_id,
        segments: r.segments,
      };
    case 'trips': {
      const end = r.finished_at;
      // Загруженные с сервера поездки знают только сумму пауз (paused_seconds) — сохраняем её.
      const paused = end != null
        ? Math.max(mergedLength(r.pauses || [], r.started_at, end), (r.paused_seconds || 0) * 1000) : 0;
      return {
        ...common, route_id: r.route_id, direction: r.direction, started_at: iso(r.started_at), finished_at: iso(end),
        time_zone: r.time_zone, duration_seconds: end != null ? Math.round(store.tripActiveMs(r) / 1000) : null,
        paused_seconds: Math.round(paused / 1000), total_cost: store.tripCost(r), currency: 'UAH',
        distance_meters: r.distance_meters, tracking_mode: r.tracking_mode, status: r.status, comment: r.comment,
      };
    }
    case 'trip_segments':
      return {
        ...common, trip_id: r.trip_id, position: r.position, transport_type: r.transport_type,
        transport_number: r.transport_number, route_name: r.route_name, started_at: iso(r.started_at),
        finished_at: iso(r.finished_at), cost: r.cost, distance_meters: r.distance_meters,
        transfer_number: r.transfer_number, comment: r.comment,
      };
    case 'inspections':
      return {
        ...common, trip_id: r.trip_id, segment_id: r.segment_id, outcome: r.outcome,
        location_latitude: r.location_latitude, location_longitude: r.location_longitude,
        observed_at: iso(r.observed_at), comment: r.comment,
      };
    default:
      throw new Error(table);
  }
}

/** Локальная запись из строки сервера. */
export function fromRemote(table, row) {
  const { user_id: _u, ...r } = row;
  const base = { ...r, created_at: ms(r.created_at), updated_at: ms(r.updated_at), deleted_at: ms(r.deleted_at) };
  switch (table) {
    case 'trips': {
      const { duration_seconds: _d, total_cost, currency: _c, ...t } = base;
      // Паузы на сервере хранятся суммой; «без разбивки» досчитывается после загрузки этапов.
      return { ...t, started_at: ms(t.started_at), finished_at: ms(t.finished_at), pauses: [], remote_total_cost: total_cost };
    }
    case 'trip_segments':
      return { ...base, started_at: ms(base.started_at), finished_at: ms(base.finished_at) };
    case 'inspections':
      return { ...base, observed_at: ms(base.observed_at) };
    default:
      return base;
  }
}

// ------------------------------------------------------------------ клиент Supabase

export class SupabaseClient {
  /** @param {{url: string, anonKey: string}} config @param {Storage} storage */
  constructor(config, storage = globalThis.localStorage, fetchFn = globalThis.fetch.bind(globalThis)) {
    this.url = config.url.replace(/\/$/, '');
    this.key = config.anonKey;
    this.storage = storage;
    this.fetch = fetchFn;
  }

  get session() {
    try {
      return JSON.parse(this.storage.getItem('rt.session') || 'null');
    } catch {
      return null;
    }
  }

  set session(s) {
    if (s) this.storage.setItem('rt.session', JSON.stringify(s));
    else this.storage.removeItem('rt.session');
  }

  get user() {
    return this.session?.user ?? null;
  }

  async #auth(path, body) {
    const res = await this.fetch(`${this.url}/auth/v1/${path}`, {
      method: 'POST',
      headers: { apikey: this.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error_description || data.msg || data.message || `Ошибка входа (${res.status})`);
    return data;
  }

  #saveSession(data) {
    if (!data.access_token) return null;
    this.session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at ? data.expires_at * 1000 : Date.now() + (data.expires_in || 3600) * 1000,
      user: { id: data.user.id, email: data.user.email },
    };
    return this.session;
  }

  async signUp(email, password) {
    const data = await this.#auth('signup', { email, password });
    // Если включено подтверждение email, сессии ещё нет.
    return this.#saveSession(data) ? 'signed_in' : 'confirm_email';
  }

  async signIn(email, password) {
    this.#saveSession(await this.#auth('token?grant_type=password', { email, password }));
  }

  async signOut() {
    const token = this.session?.access_token;
    this.session = null;
    if (token) {
      await this.fetch(`${this.url}/auth/v1/logout`, {
        method: 'POST', headers: { apikey: this.key, Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
  }

  /** Действующий токен; обновляет его заранее. null — нужно войти заново. */
  async accessToken() {
    const s = this.session;
    if (!s) return null;
    if (s.expires_at - Date.now() > 60_000) return s.access_token;
    try {
      this.#saveSession(await this.#auth('token?grant_type=refresh_token', { refresh_token: s.refresh_token }));
      return this.session.access_token;
    } catch (e) {
      if (/invalid|expired|not found|revoked/i.test(e.message)) this.session = null;
      throw e;
    }
  }

  async rest(path, { method = 'GET', body, prefer } = {}) {
    const token = await this.accessToken();
    if (!token) throw new Error('Нужно войти в аккаунт');
    const headers = { apikey: this.key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    if (prefer) headers.Prefer = prefer;
    const res = await this.fetch(`${this.url}/rest/v1/${path}`, { method, headers, body: body && JSON.stringify(body) });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Сервер ответил ${res.status}`);
    }
    return res.status === 204 ? null : res.json().catch(() => null);
  }

  /** Идемпотентный upsert по id (удаление = upsert с deleted_at). */
  upsert(table, rows) {
    return this.rest(`${table}?on_conflict=id`, { method: 'POST', body: rows, prefer: 'resolution=merge-duplicates,return=minimal' });
  }

  changesSince(table, sinceIso, limit = 1000) {
    const filter = sinceIso ? `&updated_at=gt.${encodeURIComponent(sinceIso)}` : '';
    return this.rest(`${table}?select=*${filter}&order=updated_at.asc&limit=${limit}`);
  }

  rpc(name) {
    return this.rest(`rpc/${name}`, { method: 'POST', body: {} });
  }
}

// ------------------------------------------------------------------ менеджер синхронизации

/**
 * status: {state: 'local'|'signedOut'|'offline'|'syncing'|'idle'|'error', pending, lastSyncedAt, message}
 */
export class SyncManager {
  constructor(store, client, { online = () => globalThis.navigator?.onLine ?? true, clock = () => Date.now() } = {}) {
    this.store = store;
    this.client = client;
    this.online = online;
    this.clock = clock;
    this.running = null;
    this.rerun = false;
    this.timer = null;
    this.listeners = new Set();
    this.status = { state: client ? 'idle' : 'local', pending: store.queue().length, lastSyncedAt: store.meta('lastSyncedAt'), message: null };
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  #set(patch) {
    this.status = { ...this.status, ...patch, pending: this.store.queue().length };
    for (const fn of this.listeners) fn(this.status);
  }

  /** Можно вызывать часто: параллельные прогоны схлопываются. */
  request() {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.rerun = false;
          await this.#once();
        } while (this.rerun);
      } finally {
        this.running = null;
        this.#scheduleRetry();
      }
    })();
    return this.running;
  }

  async #once() {
    if (!this.client) return this.#set({ state: 'local' });
    if (!this.online()) return this.#set({ state: 'offline' });
    if (!this.client.user) return this.#set({ state: 'signedOut' });
    this.#set({ state: 'syncing' });
    try {
      await this.push();
      await this.pull();
      const now = this.clock();
      await this.store.setMeta('lastSyncedAt', now);
      const failing = this.store.queue().find((o) => o.lastError);
      this.#set(failing ? { state: 'error', message: failing.lastError } : { state: 'idle', lastSyncedAt: now, message: null });
    } catch (e) {
      this.#set({ state: this.online() ? 'error' : 'offline', message: e.message });
    }
  }

  /** Отправка очереди пачками по таблицам, в порядке «родители → дети». */
  async push() {
    const userId = this.client.user.id;
    const ready = readyOps(this.store.queue(), this.clock(), 200);
    let i = 0;
    while (i < ready.length) {
      const batch = [ready[i]];
      while (i + batch.length < ready.length && ready[i + batch.length].entity === batch[0].entity
             && ready[i + batch.length].kind === batch[0].kind) batch.push(ready[i + batch.length]);
      i += batch.length;
      const table = batch[0].entity;
      const rows = batch.map((op) => this.store.data[table].get(op.entityId)).filter(Boolean)
        .map((r) => toRemote(table, r, userId, this.store));
      try {
        if (rows.length) await this.client.upsert(table, rows);
        await this.store.completeOps(batch);
      } catch (e) {
        const now = this.clock();
        await this.store.updateOps(batch.map((op) => markFailed(op, e.message, now)));
        if (!this.online()) throw e;
      }
    }
  }

  /** Загрузка изменений с сервера (другие устройства, переустановка). */
  async pull() {
    let tripsChanged = false;
    for (const table of ENTITIES) {
      const key = `pulledAt:${table}`;
      // updated_at ставит устройство (для last-write-wins), а часы устройств расходятся.
      // Поэтому каждый раз перечитываем последние сутки: повторы безопасны (LWW, идемпотентно).
      const saved = this.store.meta(key);
      let since = saved ? new Date(Date.parse(saved) - PULL_OVERLAP_MS).toISOString() : null;
      for (;;) {
        const rows = await this.client.changesSince(table, since);
        if (!rows?.length) break;
        const changed = await this.store.applyRemote(table, rows.map((r) => fromRemote(table, r)));
        if (table === 'trips' || table === 'trip_segments') tripsChanged ||= changed > 0;
        since = rows.at(-1).updated_at;
        if (!saved || Date.parse(since) > Date.parse(this.store.meta(key))) await this.store.setMeta(key, since);
        if (rows.length < 1000) break;
      }
    }
    if (tripsChanged) await this.#reconcileRemoteTotals();
  }

  /** Сумма «без разбивки по этапам» = итог с сервера − сумма этапов. */
  async #reconcileRemoteTotals() {
    await this.store.transact((tx) => {
      for (const t of this.store.data.trips.values()) {
        if (t.remote_total_cost == null) continue;
        const segments = this.store.segmentsOf(t.id).reduce((a, s) => a + s.cost, 0);
        const { remote_total_cost: total, ...rest } = t;
        tx.put('trips', { ...rest, extra_cost: Math.max(0, total - segments) });
      }
    });
  }

  /** Повтор только для операций, отправка которых не удалась (бэкофф). Офлайн и выход из
   *  аккаунта ждут событий online / входа, а не таймера. */
  #scheduleRetry() {
    clearTimeout(this.timer);
    if (!this.client || this.status.state !== 'error') return;
    const next = Math.min(...this.store.queue().filter((o) => o.attempts > 0).map((o) => o.nextAttemptAt));
    if (!Number.isFinite(next)) return;
    this.timer = setTimeout(() => this.request(), Math.max(1000, next - this.clock()));
    this.timer.unref?.(); // не держать процесс в тестах
  }

  async deleteAccount() {
    await this.client.rpc('delete_my_account');
    await this.client.signOut();
    await this.store.clearAll();
    this.#set({ state: 'signedOut', lastSyncedAt: null });
  }
}
