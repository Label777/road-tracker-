// Шаги по датчику движения, пока идёт этап «Пешком» и сайт открыт.
// На iPhone нужен разрешённый доступ к «Движению и ориентации» (запрос — по нажатию),
// экран во время ходьбы не гаснет (Wake Lock). Шаги сохраняются в этап каждые 10 с.
import { createStepDetector } from '../core/steps.js';

export const motionSupported = () => typeof globalThis.DeviceMotionEvent !== 'undefined';

/** Запросить доступ к датчику движения (iOS: только из обработчика нажатия). */
export async function requestMotion() {
  if (!motionSupported()) return false;
  const ask = globalThis.DeviceMotionEvent.requestPermission;
  if (typeof ask !== 'function') return true; // Android и десктоп — разрешение не нужно
  try {
    return (await ask.call(globalThis.DeviceMotionEvent)) === 'granted';
  } catch {
    return false;
  }
}

export class StepSensor {
  constructor(app) {
    this.app = app;
    this.segId = null;
    this.count = 0;
    this.saved = 0;
    this.events = 0;
    /** 'off' | 'waiting' | 'on' | 'unavailable' */
    this.status = 'off';
    this.onMotion = this.onMotion.bind(this);
    this.timer = null;
    this.probe = null;
    this.wakeLock = null;
  }

  /** Вызывается при каждом изменении данных и записи: включает счёт на текущем пешем этапе. */
  sync() {
    const { app } = this;
    const s = app.tracker.session;
    const seg = s && !s.pausedSince && app.settings().stepSensor ? app.store.segmentsOf(s.tripId).at(-1) : null;
    const walking = seg && seg.transport_type === 'walk' && seg.finished_at == null ? seg : null;
    if (walking?.id === this.segId) return;
    this.stop();
    if (walking) this.start(walking);
  }

  start(seg) {
    if (!motionSupported()) { this.status = 'unavailable'; return; }
    this.segId = seg.id;
    this.count = seg.steps ?? 0;
    this.saved = this.count;
    this.events = 0;
    this.detector = createStepDetector();
    this.status = 'waiting';
    addEventListener('devicemotion', this.onMotion);
    this.timer = setInterval(() => this.save(), 10_000);
    // Нет событий за 3 с — датчика нет или доступ закрыт
    this.probe = setTimeout(() => {
      if (!this.events) { this.status = 'unavailable'; this.app.rerender(); }
    }, 3000);
    navigator.wakeLock?.request('screen').then((l) => { this.wakeLock = l; }).catch(() => {});
  }

  stop() {
    if (!this.segId) return;
    this.save();
    removeEventListener('devicemotion', this.onMotion);
    clearInterval(this.timer);
    clearTimeout(this.probe);
    this.wakeLock?.release?.().catch(() => {});
    this.wakeLock = null;
    this.segId = null;
    this.status = 'off';
  }

  onMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    this.events++;
    if (this.status !== 'on') this.status = 'on';
    const n = this.detector.push(e.timeStamp, a.x, a.y, a.z);
    if (!n) return;
    this.count += n;
    for (const el of document.querySelectorAll('[data-steps-live]')) el.textContent = this.count.toLocaleString('ru-RU');
  }

  save() {
    if (!this.segId || this.count === this.saved) return;
    this.saved = this.count;
    this.app.store.setSegmentSteps(this.segId, this.count).catch(() => {});
  }
}
