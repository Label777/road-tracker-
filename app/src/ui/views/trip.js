// Вкладка «Поездка»: старт (свободный / по шаблону / с GPS), этапы, контролёр, пауза, завершение.
import { html } from '../html.js';
import { card, topBar, notice, empty } from '../components.js';
import { formatMoney, parseMoney, moneyToInput } from '../../core/money.js';
import { formatDuration } from '../../core/time.js';
import { trackDistance } from '../../core/geo.js';
import {
  DIRECTIONS, TRANSPORT, OUTCOME_LABELS, ICONS, segmentTitle, formatTime, formatKm, formatClock,
} from '../format.js';
import { suggestedDirection } from './dashboard.js';

const routeSummary = (r) => r.segments.map((s) => (s.transport_number ? `${TRANSPORT[s.transport_type]} ${s.transport_number}` : TRANSPORT[s.transport_type])).join(' → ');

function idle(app) {
  const routes = app.store.live('routes').sort((a, b) => a.name.localeCompare(b.name));
  const dir = app.ui.startDirection ?? suggestedDirection();
  const gps = app.ui.startGps ?? false;
  return html`
    <div class="stack">
      <div class="segmented" role="radiogroup" aria-label="Направление">
        ${Object.entries(DIRECTIONS).map(([k, v]) => html`<button role="radio" aria-checked="${k === dir}" class="${k === dir ? 'on' : ''}" data-action="set-start-direction" data-value="${k}">${v}</button>`)}
      </div>
      <label class="toggle">
        <input type="checkbox" data-field="startGps" ${gps ? 'checked' : ''}>
        <span>Записывать маршрут по GPS</span>
      </label>
      ${gps ? html`<p class="muted small">GPS работает, пока сайт открыт: экран не будет гаснуть. В фоне iPhone не даёт сайтам доступ к геолокации — время поездки при этом всё равно считается.</p>` : ''}
      <button class="start-btn" data-action="start">
        <span class="start-icon">${ICONS.play}</span>
        <span class="start-text"><strong>Начать поездку</strong><span>${DIRECTIONS[dir]}${gps ? ' · GPS' : ''}</span></span>
      </button>
      ${routes.length ? card('Начать по шаблону', html`<div class="list">${routes.map((r) => html`
        <button class="row" data-action="start-template" data-id="${r.id}">
          <span class="row-icon">${r.direction === 'to_home' ? ICONS.home : ICONS.trip}</span>
          <span class="row-main"><span class="row-title">${r.name}</span><span class="row-sub">${routeSummary(r)}</span></span>
          <span class="row-end mono">${formatMoney(r.segments.reduce((a, s) => a + s.cost, 0))}</span>
        </button>`)}</div>`) : ''}
    </div>`;
}

function recording(app) {
  const { store, tracker } = app;
  const s = tracker.session;
  const trip = store.trip(s.tripId);
  const segments = trip ? store.segmentsOf(trip.id) : [];
  const inspections = trip ? store.inspectionsOf(trip.id) : [];
  const route = trip?.route_id ? store.data.routes.get(trip.route_id) : null;
  const next = route?.segments[segments.length] ?? null;
  const board = app.ui.boarding;
  const track = trip ? store.trackOf(trip.id) : [];
  const gpsInfo = tracker.gpsInfo;

  return html`
    <div class="stack">
      ${notice(tracker.notice, tracker.notice?.kind === 'suggest' ? html`<button class="btn small primary" data-action="finish">Завершить</button>` : '')}
      ${card(DIRECTIONS[trip?.direction ?? s.direction], html`
        <div class="timer ${s.pausedSince ? 'paused' : ''}" data-timer="clock">${formatClock(tracker.activeMs())}</div>
        <div class="split muted">
          <span>Начало: ${formatTime(s.startedAt)}</span>
          <span class="mono">${formatMoney(trip ? store.tripCost(trip) : 0)}</span>
        </div>
        ${s.pausedSince ? html`<p class="warn">На паузе — время не идёт</p>` : ''}
        ${s.mode === 'gps' ? html`<p class="muted small">${ICONS.gps}
          ${gpsInfo?.error ? gpsInfo.error : gpsInfo ? `GPS: точность ±${gpsInfo.accuracy} м` : 'Ожидание GPS…'}
          ${track.length > 1 ? ` · ${formatKm(trackDistance(track))}` : ''}</p>` : ''}
        <div class="segmented small" aria-label="Направление">
          ${Object.entries(DIRECTIONS).map(([k, v]) => html`<button class="${k === trip?.direction ? 'on' : ''}" data-action="set-direction" data-value="${k}">${v}</button>`)}
        </div>
      `)}

      ${card('Этапы', html`
        ${segments.length ? html`<div class="list">${segments.map((seg) => {
          const insp = inspections.find((i) => i.segment_id === seg.id);
          return html`<div class="row static">
            <span class="row-main"><span class="row-title">${segmentTitle(seg)}</span>
              <span class="row-sub">${formatTime(seg.started_at)}${seg.finished_at ? ` – ${formatTime(seg.finished_at)}` : ' — сейчас'}${insp ? ` · ${OUTCOME_LABELS[insp.outcome]}` : ''}</span></span>
            <span class="row-end mono">${formatMoney(seg.cost)}</span></div>`;
        })}</div>` : empty('Сели в транспорт — нажмите «Сел в транспорт», чтобы учесть этап и стоимость.')}

        ${board ? html`
          <form class="form inline-form" data-action="board">
            <label>Транспорт<select name="transport_type">${Object.entries(TRANSPORT).map(([k, v]) => html`<option value="${k}" ${k === board.transport_type ? 'selected' : ''}>${v}</option>`)}</select></label>
            <label>Номер маршрута<input name="transport_number" value="${board.transport_number}" placeholder="720" autocomplete="off"></label>
            <label>Стоимость, ₴<input name="cost" inputmode="decimal" value="${moneyToInput(board.cost)}" placeholder="0"></label>
            <div class="btn-row">
              <button type="button" class="btn" data-action="cancel-board">Отмена</button>
              <button type="submit" class="btn primary">Добавить этап</button>
            </div>
          </form>` : html`
          <div class="btn-row">
            <button class="btn" data-action="open-board" data-next="${next ? JSON.stringify(next) : ''}">${ICONS.bus} Сел в транспорт</button>
            <details class="menu">
              <summary class="btn">${ICONS.shield} Контролёр</summary>
              <div class="menu-items">
                ${['no_controller', 'present_not_checked', 'ticket_checked', 'checked_at_transfer'].map((o) => html`<button data-action="inspection" data-value="${o}">${OUTCOME_LABELS[o]}</button>`)}
              </div>
            </details>
          </div>`}
      `)}

      <div class="btn-row">
        <button class="btn big" data-action="${s.pausedSince ? 'resume' : 'pause'}">${s.pausedSince ? ICONS.play : ICONS.pause} ${s.pausedSince ? 'Продолжить' : 'Пауза'}</button>
        <button class="btn big primary" data-action="finish">${ICONS.stop} Завершить</button>
      </div>
      <button class="link danger center" data-action="cancel-trip">Отменить поездку</button>
    </div>`;
}

export const tripView = {
  tab: 'trip',
  render(app) {
    return html`${topBar('Поездка')}${app.tracker.session ? recording(app) : idle(app)}`;
  },
  onInput(app, el) {
    if (el.dataset.field === 'startGps') {
      app.ui.startGps = el.checked;
      app.rerender();
    }
  },
  actions: {
    'set-start-direction': (app, el) => { app.ui.startDirection = el.dataset.value; app.rerender(); },
    start: (app) => app.tracker.send({
      type: 'start', direction: app.ui.startDirection ?? suggestedDirection(), mode: app.ui.startGps ? 'gps' : 'manual',
    }),
    'start-template': async (app, el) => {
      const route = app.store.data.routes.get(el.dataset.id);
      await app.tracker.send({ type: 'start', direction: route.direction, mode: app.ui.startGps ? 'gps' : 'manual' });
      const id = app.tracker.session?.tripId;
      if (!id) return;
      await app.store.updateTrip(id, { route_id: route.id });
      const first = route.segments[0];
      if (first) await app.store.appendLiveSegment(id, first, Date.now());
    },
    pause: (app) => app.tracker.send({ type: 'pause' }),
    resume: (app) => app.tracker.send({ type: 'resume' }),
    finish: (app) => { app.tracker.dismissNotice(); return app.tracker.send({ type: 'finish' }); },
    'cancel-trip': (app) => {
      if (confirm('Удалить текущую запись поездки?')) app.tracker.send({ type: 'cancel' });
    },
    'set-direction': (app, el) => app.store.updateTrip(app.tracker.session.tripId, { direction: el.dataset.value }),
    'open-board': (app, el) => {
      const next = el.dataset.next ? JSON.parse(el.dataset.next) : null;
      app.ui.boarding = { transport_type: next?.transport_type ?? 'minibus', transport_number: next?.transport_number ?? '', cost: next?.cost ?? 0 };
      app.rerender();
    },
    'cancel-board': (app) => { app.ui.boarding = null; app.rerender(); },
    board: async (app, form) => {
      const data = new FormData(form);
      const cost = parseMoney(data.get('cost') || '0');
      if (cost == null) return app.toast('Введите стоимость, например 30 или 30,50');
      app.ui.boarding = null;
      await app.store.appendLiveSegment(app.tracker.session.tripId, {
        transport_type: data.get('transport_type'), transport_number: data.get('transport_number'), cost,
      }, Date.now());
      return undefined;
    },
    inspection: async (app, el) => {
      el.closest('details')?.removeAttribute('open');
      const point = app.tracker.lastSample ? { lat: app.tracker.lastSample.lat, lon: app.tracker.lastSample.lon } : null;
      await app.store.recordInspection(app.tracker.session.tripId, el.dataset.value, Date.now(), point);
      app.toast(`Отмечено: ${OUTCOME_LABELS[el.dataset.value]}`);
    },
  },
};
