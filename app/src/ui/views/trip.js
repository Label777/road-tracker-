// Активная поездка: большая карта с живым маршрутом, панель с таймером, расстоянием,
// временем старта и транспортом; этапы, контролёр, пауза, завершение.
import { html } from '../html.js';
import {
  topBar, trackingStatus, segmented, transportSelector, primaryButton, secondaryButton, notice, emptyState, sectionTitle,
} from '../components.js';
import { formatMoney, parseMoney, moneyToInput } from '../../core/money.js';
import { trackDistance, segmentDistances } from '../../core/geo.js';
import { segmentSteps, STEP_SOURCE } from '../../core/steps.js';
import { motionSupported, requestMotion } from '../step-sensor.js';
import {
  DIRECTIONS, TRANSPORT, OUTCOME_LABELS, ICONS, TRANSPORT_ICONS, segmentTitle, formatTime, formatKm, formatClock,
  formatDistance, formatSteps, plural,
} from '../format.js';
import { LiveMap } from '../map.js';
import { sheetHeader } from '../sheet.js';
import { frequentCosts, routeNumbers } from '../suggest.js';
import { finishTrip, finishedText } from '../actions.js';
import { openChangeSheet, openEditSheet, MAIN_TRANSPORT } from './start-sheet.js';
import { canImportHealth, importFromHealth } from '../health.js';

/** Пока идём пешком: откуда шаги и как включить датчик. */
function walkingNote(app, estimate, sensing) {
  const sensor = app.steps;
  if (sensing && sensor.status === 'unavailable') {
    return html`<p class="t-caption warn">Датчик движения не отвечает — шаги считаются ${estimate ? STEP_SOURCE[estimate.source] : 'по расстоянию или времени'}.</p>`;
  }
  if (sensing) return html`<p class="t-caption accent">Шаги считает датчик телефона — держите сайт открытым.</p>`;
  return html`<p class="t-caption">${estimate ? `Шаги — оценка ${STEP_SOURCE[estimate.source]}.` : ''}
    ${motionSupported() ? html` <button class="btn btn-ghost btn-sm" data-action="enable-steps">Считать шаги датчиком</button>` : ''}</p>`;
}

/** «Сменил транспорт»: что сейчас и пересадка в одно-два касания. */
function changeBlock(current, walking = '') {
  const options = MAIN_TRANSPORT.filter((t) => t !== current?.transport_type);
  return html`
    <div class="change-block">
      <p class="t-callout">${current
        ? html`Сейчас: <b>${segmentTitle(current)}</b> · с ${formatTime(current.started_at)}`
        : 'Отметьте, на чём едете — так учтутся цена и пересадки.'}</p>
      ${walking}
      <p class="t-caption" style="margin:var(--s-2) 0">${current ? 'Сменили транспорт?' : 'На чём едете?'}</p>
      <div class="change-buttons" role="group" aria-label="${current ? 'Сменить транспорт' : 'Выбрать транспорт'}">
        ${options.map((t) => html`<button class="change-option tr-${t}" data-action="change-to" data-value="${t}">${TRANSPORT_ICONS[t]}<span>${TRANSPORT[t]}</span></button>`)}
        <button class="change-option" data-action="open-board">${ICONS.plus}<span>Другое</span></button>
      </div>
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
  const now = Date.now();
  // Расстояние этапов: сохранённое или по треку (для текущего — до этой секунды)
  const live = track.length > 1 ? segmentDistances(track, segments, now) : new Map();
  const distOf = (seg) => seg.distance_meters ?? (live.get(seg.id) || null);
  const stride = store.stride();
  const stepsOf = (seg) => segmentSteps(seg, { stride, now, distance: distOf(seg) });
  const walkSegs = segments.filter((x) => x.transport_type === 'walk');
  const sensor = app.steps;
  const sensing = sensor?.segId && sensor.segId === current?.id;
  let totalSteps = 0;
  for (const seg of walkSegs) totalSteps += (seg.id === current?.id && sensing ? sensor.count : stepsOf(seg)?.steps) || 0;
  const walkingNow = current && !current.finished_at && current.transport_type === 'walk';
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
          ${walkSegs.length
            ? html`<div><span class="t-caption">Шаги</span><span class="t-num" ${sensing && walkSegs.length === 1 ? html`data-steps-live` : ''}>${totalSteps ? totalSteps.toLocaleString('ru-RU') : '—'}</span></div>`
            : html`<div><span class="t-caption">Старт</span><span class="t-num">${formatTime(s.startedAt)}</span></div>`}
          <div><span class="t-caption">Стоимость</span><span class="t-num">${formatMoney(trip ? store.tripCost(trip) : 0)}</span></div>
        </div>

        <section>
          ${sectionTitle('Этапы', segments.length ? html`<span class="t-caption">нажмите, чтобы изменить</span>` : '')}
          ${segments.length ? html`<div class="timeline">${segments.map((seg, i) => {
            const insp = inspections.find((x) => x.segment_id === seg.id);
            return html`<div class="timeline-item editable tr-${seg.transport_type} ${i === segments.length - 1 && !seg.finished_at ? 'current' : ''}"
              role="button" tabindex="0" data-action="edit-segment" data-id="${seg.id}" aria-label="Изменить этап: ${segmentTitle(seg)}, ${formatMoney(seg.cost)}">
              <div class="row-between"><span class="t-sub">${segmentTitle(seg)}</span><span class="t-num">${formatMoney(seg.cost)}<span class="edit-mark" aria-hidden="true">${ICONS.edit}</span></span></div>
              <div class="t-caption">${formatTime(seg.started_at)}${seg.finished_at ? ` – ${formatTime(seg.finished_at)}` : ' — сейчас'}${distOf(seg) ? ` · ${formatDistance(distOf(seg))}` : ''}${(() => {
                if (seg.transport_type !== 'walk') return '';
                if (seg.id === current?.id && sensing) return html` · <span data-steps-live>${sensor.count.toLocaleString('ru-RU')}</span> ${plural(sensor.count, 'шаг', 'шага', 'шагов')}`;
                const st = stepsOf(seg);
                return st ? ` · ${formatSteps(st.steps, st.source)}` : '';
              })()}${insp ? ` · ${OUTCOME_LABELS[insp.outcome]}` : ''}</div>
            </div>`;
          })}</div>` : ''}
          ${changeBlock(current && !current.finished_at ? current : null, walkingNow ? walkingNote(app, stepsOf(current), sensing) : '')}
          <div class="btn-row" style="margin-top:var(--s-3)">
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
    // Старт — на главной; без записи этот экран не нужен
    if (!app.tracker.session) {
      queueMicrotask(() => { if (location.hash === '#/trip') location.replace('#/home'); });
      return '';
    }
    return recording(app);
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
    lm.update(app.store.trackOf(s.tripId), places, app.store.segmentsOf(s.tripId));
  },
  actions: {
    'enable-gps': (app) => app.tracker.send({ type: 'enableGps' }),
    pause: (app) => { app.haptic(); return app.tracker.send({ type: 'pause' }); },
    resume: (app) => { app.haptic(); return app.tracker.send({ type: 'resume' }); },
    finish: async (app) => {
      const trip = await finishTrip(app);
      app.haptic('success');
      // Пешком без датчика — предложить шаги из «Здоровья» (если команда настроена)
      const walkNoSteps = trip && app.store.segmentsOf(trip.id).some((x) => x.transport_type === 'walk' && x.steps == null);
      if (walkNoSteps && app.settings().healthShortcut && canImportHealth(app.store, trip)) {
        app.toast(finishedText(app, trip), { action: 'Шаги из «Здоровья»', run: () => importFromHealth(app, trip.id), duration: 8000 });
      } else {
        app.toast(finishedText(app, trip));
      }
    },
    'cancel-trip': async (app) => {
      const ok = await app.confirm({ title: 'Отменить поездку?', text: 'Запись, этапы и трек будут удалены.', confirm: 'Удалить запись', danger: true });
      if (ok) {
        await app.tracker.send({ type: 'cancel' });
        app.ui.liveMap = null;
      }
    },
    'change-direction': (app) => app.openSheet(directionSheet),
    // «Другое»: следующий этап шаблона, если поездка по шаблону, иначе полный список транспорта
    'open-board': (app) => {
      const s = app.tracker.session;
      const trip = app.store.trip(s.tripId);
      const route = trip?.route_id ? app.store.data.routes.get(trip.route_id) : null;
      const next = route?.segments[app.store.segmentsOf(s.tripId).length] ?? null;
      openChangeSheet(app, next ? { template: next } : { transport: 'metro' });
    },
    'enable-steps': async (app) => {
      if (!(await requestMotion())) {
        app.toast('Нет доступа к датчику движения. Разрешить: Настройки → Safari → «Движение и ориентация».');
        return;
      }
      await app.saveSettings({ stepSensor: true });
      app.haptic('success');
    },
    'edit-segment': (app, el) => { app.haptic(); openEditSheet(app, el.dataset.id); },
    'change-to': (app, el) => { app.haptic(); openChangeSheet(app, { transport: el.dataset.value }); },
    'open-inspection': (app) => app.openSheet(inspectionSheet),
  },
};
