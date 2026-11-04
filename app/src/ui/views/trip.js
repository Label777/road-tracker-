// Активная поездка: большая карта с живым маршрутом, панель с таймером, расстоянием,
// временем старта и транспортом; этапы, контролёр, пауза, завершение.
import { html } from '../html.js';
import {
  topBar, trackingStatus, segmented, transportSelector, primaryButton, secondaryButton, notice, emptyState, sectionTitle,
} from '../components.js';
import { formatMoney, parseMoney, moneyToInput } from '../../core/money.js';
import { trackDistance } from '../../core/geo.js';
import {
  DIRECTIONS, TRANSPORT, OUTCOME_LABELS, ICONS, TRANSPORT_ICONS, segmentTitle, formatTime, formatKm, formatClock,
} from '../format.js';
import { LiveMap } from '../map.js';
import { sheetHeader } from '../sheet.js';
import { frequentCosts, routeNumbers } from '../suggest.js';
import { suggestedDirection } from './dashboard.js';

const routeSummary = (r) => r.segments.map((s) => (s.transport_number ? `${TRANSPORT[s.transport_type]} ${s.transport_number}` : TRANSPORT[s.transport_type])).join(' → ');

// ------------------------------------------------------------------ ожидание старта

function idle(app) {
  const routes = app.store.live('routes').sort((a, b) => a.name.localeCompare(b.name));
  const dir = app.ui.startDirection ?? suggestedDirection();
  const gps = app.ui.startGps ?? app.settings().gpsByDefault;
  return html`
    ${topBar('Поездка', { large: true })}
    <div class="stack-lg reveal">
      <div class="stack">
        ${segmented(DIRECTIONS, dir, { action: 'set-start-direction', label: 'Направление' })}
        <label class="switch-row surface" style="padding:var(--s-2) var(--s-4)">
          <span><span class="t-sub">Записывать маршрут по GPS</span><br><span class="t-caption">Пока сайт открыт — экран не погаснет</span></span>
          <input type="checkbox" class="switch" data-field="startGps" ${gps ? 'checked' : ''}>
        </label>
        ${primaryButton(html`Начать поездку`, { action: 'start', size: 'lg', icon: ICONS.play })}
      </div>
      ${routes.length ? html`<section>
        ${sectionTitle('По шаблону', html`<a href="#/routes">Изменить</a>`)}
        <div class="stack">${routes.map((r) => html`
          <button class="trip-card featured" data-action="start-template" data-id="${r.id}">
            <span class="glyph ${r.direction === 'to_work' ? 'work' : ''}">${r.direction === 'to_home' ? ICONS.home : ICONS.work}</span>
            <span class="main"><span class="title">${r.name}</span><span class="sub">${routeSummary(r)}</span></span>
            <span class="end t-num">${formatMoney(r.segments.reduce((a, s) => a + s.cost, 0))}</span>
          </button>`)}</div>
      </section>` : html`<section>${emptyState({
        icon: ICONS.route, title: 'Шаблоны ускоряют запись',
        text: 'Сохраните обычный маршрут — например, «маршрутка 720 → метро» — и начинайте поездку в одно касание.',
        action: html`<a class="btn btn-secondary btn-sm" href="#/route/new">Создать шаблон</a>`,
      })}</section>`}
    </div>`;
}

// ------------------------------------------------------------------ запись

function recording(app) {
  const { store, tracker } = app;
  const s = tracker.session;
  const trip = store.trip(s.tripId);
  const segments = trip ? store.segmentsOf(trip.id) : [];
  const inspections = trip ? store.inspectionsOf(trip.id) : [];
  const track = trip ? store.trackOf(trip.id) : [];
  const current = segments.at(-1);
  const info = tracker.gpsInfo;
  const status = s.pausedSince ? trackingStatus('warn', 'Пауза')
    : s.mode !== 'gps' ? trackingStatus('idle', 'Без GPS')
      : info?.error ? trackingStatus('warn', info.error)
        : trackingStatus('on', info ? `Запись · ±${info.accuracy} м` : 'Поиск GPS…');

  return html`
    <div class="trip-screen">
      <div class="trip-map ${s.mode === 'gps' || track.length ? '' : 'compact'}">
        ${s.mode === 'gps' || track.length ? html`<div data-live-map></div>` : html`
          <div class="no-gps">
            <span>${ICONS.gps}</span>
            <p class="t-callout">Маршрут не записывается. Время и расходы считаются.</p>
            <button class="btn btn-secondary btn-sm" data-action="enable-gps">Включить GPS</button>
          </div>`}
        <div class="overlay-top">${status}<span class="tracking-status">${DIRECTIONS[trip?.direction ?? s.direction]}</span></div>
      </div>

      <div class="trip-panel">
        ${notice(tracker.notice, tracker.notice?.kind === 'suggest' ? html`<button class="btn btn-primary btn-sm" data-action="finish">Завершить</button>` : '')}
        <div class="row-between">
          <div>
            <div class="trip-clock ${s.pausedSince ? 'paused' : ''}" data-timer="clock" role="timer" aria-live="off">${formatClock(tracker.activeMs())}</div>
            <p class="t-caption">${s.pausedSince ? 'На паузе — время не идёт' : 'в пути'}</p>
          </div>
          <button class="icon-btn" data-action="change-direction" aria-label="Изменить направление">${ICONS.repeat}</button>
        </div>

        <div class="trip-stats">
          <div><span class="t-caption">Расстояние</span><span class="t-num">${track.length > 1 ? formatKm(trackDistance(track)) : '—'}</span></div>
          <div><span class="t-caption">Старт</span><span class="t-num">${formatTime(s.startedAt)}</span></div>
          <div><span class="t-caption">Стоимость</span><span class="t-num">${formatMoney(trip ? store.tripCost(trip) : 0)}</span></div>
        </div>

        <section>
          ${sectionTitle('Этапы', current ? html`<span class="t-caption">${TRANSPORT_ICONS[current.transport_type]}</span>` : '')}
          ${segments.length ? html`<div class="timeline">${segments.map((seg, i) => {
            const insp = inspections.find((x) => x.segment_id === seg.id);
            return html`<div class="timeline-item ${i === segments.length - 1 && !seg.finished_at ? 'current' : ''}">
              <div class="row-between"><span class="t-sub">${segmentTitle(seg)}</span><span class="t-num">${formatMoney(seg.cost)}</span></div>
              <div class="t-caption">${formatTime(seg.started_at)}${seg.finished_at ? ` – ${formatTime(seg.finished_at)}` : ' — сейчас'}${insp ? ` · ${OUTCOME_LABELS[insp.outcome]}` : ''}</div>
            </div>`;
          })}</div>` : html`<p class="t-callout muted">Сели в транспорт — отметьте этап, чтобы учесть стоимость и пересадки.</p>`}
          <div class="btn-row" style="margin-top:var(--s-3)">
            ${secondaryButton('Сел в транспорт', { action: 'open-board', icon: TRANSPORT_ICONS.bus })}
            ${secondaryButton('Контролёр', { action: 'open-inspection', icon: ICONS.shield })}
          </div>
        </section>

        <div class="btn-row" style="margin-top:var(--s-6)">
          ${secondaryButton(s.pausedSince ? 'Продолжить' : 'Пауза', { action: s.pausedSince ? 'resume' : 'pause', size: 'lg', icon: s.pausedSince ? ICONS.play : ICONS.pause })}
          ${primaryButton('Завершить', { action: 'finish', size: 'lg', icon: ICONS.stop })}
        </div>
        <button class="btn btn-danger" style="width:100%;margin-top:var(--s-3)" data-action="cancel-trip">Отменить поездку</button>
      </div>
    </div>`;
}

// ------------------------------------------------------------------ шторки

function boardingSheet(app, template) {
  app.ui.board = {
    transport_type: template?.transport_type ?? 'minibus',
    transport_number: template?.transport_number ?? '',
    cost: template?.cost ?? 0,
  };
  return {
    label: 'Новый этап',
    render: (a) => {
      const b = a.ui.board;
      const costs = frequentCosts(a.store, b.transport_type);
      const numbers = b.transport_number ? [] : routeNumbers(a.store, '', 4).filter((x) => x.transport_type === b.transport_type);
      return html`
        ${sheetHeader('Сел в транспорт')}
        <div class="stack">
          ${transportSelector(b.transport_type, { action: 'board-transport' })}
          <label class="field"><span>Номер маршрута</span>
            <input data-field="board.transport_number" value="${b.transport_number}" placeholder="Например, 720" autocomplete="off" inputmode="text" enterkeyhint="done"></label>
          ${numbers.length ? html`<div class="chips">${numbers.map((n) => html`<button class="chip" data-action="board-number" data-value="${n.transport_number}">№${n.transport_number}</button>`)}</div>` : ''}
          <label class="field"><span>Стоимость</span>
            <span class="input-affix"><input class="numeric-input" data-field="board.cost" inputmode="decimal" value="${moneyToInput(b.cost)}" placeholder="0"><span class="affix">₴</span></span></label>
          ${costs.length ? html`<div class="chips">${costs.map((c) => html`<button class="chip ${c === b.cost ? 'on' : ''}" data-action="board-cost" data-value="${c}">${formatMoney(c)}</button>`)}</div>` : ''}
          ${primaryButton('Добавить этап', { action: 'board-save', size: 'lg' })}
        </div>`;
    },
    onInput: (a, el) => {
      const b = a.ui.board;
      if (el.dataset.field === 'board.cost') {
        const m = parseMoney(el.value || '0');
        el.classList.toggle('invalid', m == null);
        if (m != null) b.cost = m;
      } else b.transport_number = el.value;
      return false;
    },
    actions: {
      'board-transport': (a, el) => { a.ui.board.transport_type = el.dataset.value; a.haptic(); a.renderSheet(); },
      'board-number': (a, el) => { a.ui.board.transport_number = el.dataset.value; a.renderSheet(); },
      'board-cost': (a, el) => { a.ui.board.cost = +el.dataset.value; a.haptic(); a.renderSheet(); },
      'board-save': async (a) => {
        await a.store.appendLiveSegment(a.tracker.session.tripId, a.ui.board, Date.now());
        a.haptic('success');
        a.closeSheet();
      },
    },
  };
}

const inspectionSheet = {
  label: 'Контролёр',
  render: () => html`
    ${sheetHeader('Контролёр')}
    <p class="t-callout muted" style="margin-bottom:var(--s-4)">Отмечайте и поездки без контролёра — иначе статистика будет завышена.</p>
    <div class="stack">
      ${['no_controller', 'present_not_checked', 'ticket_checked', 'checked_at_transfer'].map((o) =>
        secondaryButton(OUTCOME_LABELS[o], { action: 'inspection', size: 'lg', 'data-value': o }))}
    </div>`,
  actions: {
    inspection: async (app, el) => {
      const point = app.tracker.lastSample ? { lat: app.tracker.lastSample.lat, lon: app.tracker.lastSample.lon } : null;
      await app.store.recordInspection(app.tracker.session.tripId, el.dataset.value, Date.now(), point);
      app.haptic();
      app.closeSheet();
      app.toast(`Отмечено: ${OUTCOME_LABELS[el.dataset.value]}`);
    },
  },
};

const directionSheet = {
  label: 'Направление',
  render: (app) => html`
    ${sheetHeader('Направление')}
    <div class="stack">${Object.entries(DIRECTIONS).map(([k, v]) => html`
      <button class="btn btn-lg ${k === app.store.trip(app.tracker.session.tripId)?.direction ? 'btn-primary' : 'btn-secondary'}" data-action="set-direction" data-value="${k}">${v}</button>`)}</div>`,
  actions: {
    'set-direction': async (app, el) => {
      await app.store.updateTrip(app.tracker.session.tripId, { direction: el.dataset.value });
      app.closeSheet();
    },
  },
};

// ------------------------------------------------------------------ экран

export const tripView = {
  tab: 'trip',
  render(app) {
    return app.tracker.session ? recording(app) : idle(app);
  },
  mount(app, root) {
    const slot = root.querySelector('[data-live-map]');
    const s = app.tracker.session;
    if (!slot || !s) return;
    if (app.ui.liveMap?.tripId !== s.tripId) app.ui.liveMap = Object.assign(new LiveMap(), { tripId: s.tripId });
    const lm = app.ui.liveMap;
    lm.attach(slot.parentElement);
    slot.remove();
    const places = app.store.live('locations').map((p) => ({ lat: p.latitude, lon: p.longitude, radius: p.radius }));
    lm.update(app.store.trackOf(s.tripId), places);
  },
  onInput(app, el) {
    if (el.dataset.field === 'startGps') {
      app.ui.startGps = el.checked;
      app.haptic();
    }
    return false;
  },
  actions: {
    'set-start-direction': (app, el) => { app.ui.startDirection = el.dataset.value; app.haptic(); app.rerender(); },
    start: async (app) => {
      app.haptic('success');
      await app.tracker.send({
        type: 'start', direction: app.ui.startDirection ?? suggestedDirection(),
        mode: (app.ui.startGps ?? app.settings().gpsByDefault) ? 'gps' : 'manual',
      });
    },
    'start-template': async (app, el) => {
      const route = app.store.data.routes.get(el.dataset.id);
      app.haptic('success');
      await app.tracker.send({ type: 'start', direction: route.direction, mode: (app.ui.startGps ?? app.settings().gpsByDefault) ? 'gps' : 'manual' });
      const id = app.tracker.session?.tripId;
      if (!id) return;
      await app.store.updateTrip(id, { route_id: route.id });
      const first = route.segments[0];
      if (first) await app.store.appendLiveSegment(id, first, Date.now());
    },
    'enable-gps': (app) => app.tracker.send({ type: 'enableGps' }),
    pause: (app) => { app.haptic(); return app.tracker.send({ type: 'pause' }); },
    resume: (app) => { app.haptic(); return app.tracker.send({ type: 'resume' }); },
    finish: async (app) => {
      app.tracker.dismissNotice();
      await app.tracker.send({ type: 'finish' });
      app.haptic('success');
      app.ui.liveMap = null;
      app.toast('Поездка сохранена');
    },
    'cancel-trip': async (app) => {
      const ok = await app.confirm({ title: 'Отменить поездку?', text: 'Запись, этапы и трек будут удалены.', confirm: 'Удалить запись', danger: true });
      if (ok) {
        await app.tracker.send({ type: 'cancel' });
        app.ui.liveMap = null;
      }
    },
    'change-direction': (app) => app.openSheet(directionSheet),
    'open-board': (app) => {
      const s = app.tracker.session;
      const trip = app.store.trip(s.tripId);
      const route = trip?.route_id ? app.store.data.routes.get(trip.route_id) : null;
      const next = route?.segments[app.store.segmentsOf(s.tripId).length] ?? null;
      app.openSheet(boardingSheet(app, next));
    },
    'open-inspection': (app) => app.openSheet(inspectionSheet),
  },
};
