// Контроллер записи поездки: машина состояний + хранилище + GPS браузера.
//
// Ограничение браузера (честно): Safari на iPhone не даёт сайтам геолокацию в фоне.
// GPS пишет маршрут, только пока сайт открыт; Wake Lock не даёт экрану погаснуть.
// Если вкладку свернули, время поездки всё равно считается, а трек продолжится при возврате.
import { reduce, initialState, sessionActiveMs } from '../core/tracking.js';
import { gpsPolicy, shouldRecord } from '../core/geo.js';

export class Tracker {
  constructor(store, { geolocation = globalThis.navigator?.geolocation, clock = () => Date.now() } = {}) {
    this.store = store;
    this.geo = geolocation;
    this.clock = clock;
    this.state = store.meta('tracking', initialState());
    this.watchId = null;
    this.wakeLock = null;
    this.lastSample = null;
    this.buffer = [];
    this.gpsInfo = null; // {accuracy, at} | {error}
    this.notice = null; // сообщение для пользователя
    this.listeners = new Set();
    this.queue = Promise.resolve();
    if (this.state.status === 'recording' && this.state.session.mode === 'gps' && !this.state.session.pausedSince) {
      this.#startGps(); // поездка продолжается после перезагрузки страницы
    }
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  #emit() {
    for (const fn of this.listeners) fn();
  }

  get session() {
    return this.state.status === 'recording' ? this.state.session : null;
  }

  activeMs(now = this.clock()) {
    return this.session ? sessionActiveMs(this.session, now) : 0;
  }

  /** События обрабатываются строго по очереди: двойное нажатие не создаёт двух поездок. */
  send(event) {
    this.queue = this.queue.then(() => this.#handle(event)).catch((e) => {
      this.notice = { kind: 'error', text: e.message };
      this.#emit();
    });
    return this.queue;
  }

  async #handle(event) {
    const { state, effects } = reduce(this.state, { at: this.clock(), ...event });
    if (state === this.state && !effects.length) return; // ничего не изменилось (частые GPS-события)
    this.state = state;
    await this.store.setMeta('tracking', state);
    for (const e of effects) await this.#apply(e);
    this.#emit();
  }

  async #apply(e) {
    switch (e.type) {
      case 'tripStarted': return this.store.startTrip(e.session);
      case 'tripPaused': return this.store.setPaused(e.session.tripId, true, e.session.pauses);
      case 'tripResumed': return this.store.setPaused(e.session.tripId, false, e.session.pauses);
      case 'tripFinished':
        await this.#flush();
        return this.store.finishTrip(e.session, e.end);
      case 'tripCancelled': return this.store.deleteTrip(e.tripId);
      case 'startGps': return this.#startGps();
      case 'stopGps': return this.#stopGps();
      case 'degradedToManual':
        this.notice = { kind: 'warning', text: 'Доступ к геолокации запрещён — поездка продолжается без GPS. Разрешить можно в настройках Safari.' };
        return undefined;
      case 'suggestFinish':
        this.notice = { kind: 'suggest', text: `Похоже, вы на месте: «${e.place}». Завершить поездку?` };
        if (this.store.meta('settings', {}).notifications && globalThis.Notification?.permission === 'granted'
            && document.visibilityState !== 'visible') {
          try { new Notification('Road Tracker', { body: this.notice.text, tag: 'finish' }); } catch { /* iOS: только из PWA */ }
        }
        return undefined;
      default:
        return undefined;
    }
  }

  dismissNotice() {
    this.notice = null;
    this.#emit();
  }

  // ------------------------------------------------------------------ GPS

  #startGps() {
    if (!this.geo) {
      this.send({ type: 'gpsDenied' });
      return;
    }
    if (this.watchId != null) return;
    const policy = gpsPolicy();
    this.watchId = this.geo.watchPosition(
      (pos) => this.#onPosition(pos),
      (err) => {
        if (err.code === 1) this.send({ type: 'gpsDenied' });
        else {
          this.gpsInfo = { error: err.code === 3 ? 'Нет сигнала GPS' : 'GPS недоступен' };
          this.#emit();
        }
      },
      { enableHighAccuracy: policy.enableHighAccuracy, maximumAge: 5_000, timeout: 30_000 },
    );
    this.#keepAwake();
  }

  #stopGps() {
    if (this.watchId != null) this.geo?.clearWatch(this.watchId);
    this.watchId = null;
    this.lastSample = null;
    this.gpsInfo = null;
    this.wakeLock?.release?.().catch(() => {});
    this.wakeLock = null;
    return this.#flush();
  }

  async #keepAwake() {
    try {
      this.wakeLock = await navigator.wakeLock?.request('screen');
    } catch { /* не поддерживается или вкладка скрыта */ }
  }

  /** После возврата во вкладку Wake Lock снимается системой — берём заново. */
  onVisible() {
    if (this.watchId != null) this.#keepAwake();
  }

  #onPosition(pos) {
    const session = this.session;
    if (!session || session.pausedSince) return;
    const sample = {
      lat: pos.coords.latitude, lon: pos.coords.longitude, t: pos.timestamp || this.clock(),
      acc: pos.coords.accuracy, speed: pos.coords.speed ?? -1,
    };
    this.gpsInfo = { accuracy: Math.round(sample.acc), at: sample.t };
    const policy = gpsPolicy({ speed: sample.speed });
    if (shouldRecord(this.lastSample, sample, policy)) {
      this.lastSample = sample;
      this.buffer.push(sample);
      if (this.buffer.length >= 5) this.#flush();
    }
    const settings = this.store.meta('settings', {});
    if (settings.finishHints === false) return; // подсказки о прибытии выключены в настройках
    const places = this.store.live('locations').map((p) => ({ lat: p.latitude, lon: p.longitude, radius: p.radius, name: p.name }));
    this.send({ type: 'position', point: { lat: sample.lat, lon: sample.lon }, places, at: sample.t });
  }

  async #flush() {
    const session = this.session;
    const samples = this.buffer.splice(0);
    const tripId = session?.tripId ?? this.state.session?.tripId;
    if (samples.length && tripId) await this.store.addTrackPoints(tripId, samples);
  }

  /** Сохранить буфер при скрытии вкладки (iOS может выгрузить страницу). */
  flush() {
    return this.#flush();
  }

  /** Текущее местоположение одним запросом (для выбора места на карте). */
  currentPosition() {
    return new Promise((resolve, reject) => {
      if (!this.geo) return reject(new Error('Геолокация недоступна'));
      this.geo.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
        (e) => reject(new Error(e.code === 1 ? 'Доступ к геолокации запрещён' : 'Не удалось определить местоположение')),
        { enableHighAccuracy: true, timeout: 15_000 },
      );
      return undefined;
    });
  }
}
