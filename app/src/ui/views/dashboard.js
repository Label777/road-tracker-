// Главная: приветствие и статус GPS, большая кнопка старта, показатели дня,
// последняя поездка, прогресс месяца («дорога»), быстрые действия.
import { html } from '../html.js';
import {
  metricCard, metricGrid, tripCard, trackingStatus, emptyState, sectionTitle, notice,
} from '../components.js';
import { formatMoney } from '../../core/money.js';
import { formatDuration, periodInterval, zonedParts } from '../../core/time.js';
import { totalsOf, inInterval, monthToDateComparison, averageTripMs } from '../../core/analytics.js';
import { DIRECTIONS, ICONS, LOCALE, formatPercent, formatClock } from '../format.js';
import { gpsPermission } from '../permissions.js';

export const suggestedDirection = (now = Date.now()) => (zonedParts(now).hour < 14 ? 'to_work' : 'to_home');

/** Старт поездки с главной (с анимацией и тактильным откликом). */
export async function quickStart(app, direction = app.ui.homeDirection ?? suggestedDirection()) {
  const orb = document.querySelector('.start-orb');
  orb?.classList.add('launch');
  app.haptic('success');
  const mode = app.settings().gpsByDefault ? 'gps' : 'manual';
  await app.tracker.send({ type: 'start', direction, mode });
}

function greeting(now) {
  const h = zonedParts(now).hour;
  if (h < 5) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
}

function gpsBadge(app) {
  const s = app.tracker.session;
  if (s?.mode === 'gps') {
    const info = app.tracker.gpsInfo;
    if (info?.error) return trackingStatus('warn', info.error);
    return trackingStatus('on', info ? `GPS ±${info.accuracy} м` : 'GPS: поиск');
  }
  const p = app.ui.gpsPermission;
  if (p === 'denied') return trackingStatus('off', 'GPS запрещён');
  if (p === 'granted') return trackingStatus('idle', 'GPS готов');
  return trackingStatus('idle', 'GPS по запросу');
}

function startOrb(app) {
  const s = app.tracker.session;
  if (s) {
    return html`
      <button class="start-orb recording" data-action="open-trip" aria-label="Идёт запись поездки, открыть">
        <svg class="ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="48"/></svg>
        <span class="label"><strong data-timer="clock">${formatClock(app.tracker.activeMs())}</strong><span>${s.pausedSince ? 'на паузе' : 'идёт запись'}</span></span>
      </button>`;
  }
  const dir = app.ui.homeDirection ?? suggestedDirection();
  return html`
    <button class="start-orb" data-action="quick-start" aria-label="Начать поездку: ${DIRECTIONS[dir]}">
      <svg class="ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="48"/></svg>
      <span class="label">${ICONS.play}<strong>Старт</strong><span>${DIRECTIONS[dir].toLowerCase()}</span></span>
    </button>`;
}

export const dashboard = {
  tab: 'home',
  init(app) {
    gpsPermission().then((p) => {
      if (app.ui.gpsPermission !== p) { app.ui.gpsPermission = p; app.rerender(); }
    });
  },
  render(app) {
    const { store, tracker } = app;
    const now = Date.now();
    const trips = store.completedSummaries();
    const today = totalsOf(inInterval(trips, periodInterval('day', now)));
    const month = monthToDateComparison(trips, now);
    const avg = averageTripMs(month.current);
    const last = store.liveTrips().find((t) => t.status === 'completed');
    const dir = app.ui.homeDirection ?? suggestedDirection();
    const dateText = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' }).format(now);

    // Прогресс месяца: потрачено к дате против всего прошлого месяца
    const target = month.previousFull.cost;
    const share = target > 0 ? Math.min(1, month.current.cost / target) : (month.current.cost > 0 ? 1 : 0);
    const prevMarker = target > 0 ? Math.min(1, month.previous.cost / target) : null;

    return html`
      <header class="greeting">
        <div class="row-between">
          <span class="brand">${ICONS.logo}ROAD TRACKER</span>
          ${gpsBadge(app)}
        </div>
        <h1>${greeting(now)}</h1>
        <p class="date">${dateText.charAt(0).toUpperCase() + dateText.slice(1)}</p>
      </header>

      <section class="hero">
        ${startOrb(app)}
        ${tracker.session ? html`<p class="t-caption">Нажмите, чтобы открыть поездку</p>` : html`
          <div class="hero-sub" role="group" aria-label="Направление">
            ${['to_work', 'to_home'].map((k) => html`<button class="chip ${k === dir ? 'on' : ''}" aria-pressed="${k === dir}" data-action="home-direction" data-value="${k}">${DIRECTIONS[k]}</button>`)}
          </div>`}
      </section>

      ${notice(tracker.notice, tracker.notice?.kind === 'suggest' ? html`<button class="btn btn-primary btn-sm" data-action="open-trip">Открыть</button>` : '')}

      <section class="reveal" aria-label="Сегодня">
        ${sectionTitle('Сегодня')}
        ${metricGrid(
          metricCard('В пути', formatDuration(today.activeMs), { icon: ICONS.clock }),
          metricCard('Потрачено', formatMoney(today.cost), { icon: ICONS.wallet }),
          metricCard('Поездок', String(today.trips), { icon: ICONS.route, hint: today.transfers ? `пересадок: ${today.transfers}` : '' }),
          metricCard('Средняя поездка', avg != null ? formatDuration(avg) : '—', { icon: ICONS.target, hint: 'за месяц' }),
        )}
      </section>

      <section class="reveal" style="margin-top:var(--s-8)">
        ${sectionTitle('Последняя поездка', html`<a href="#/history">Вся история</a>`)}
        ${last ? tripCard(store, last, { featured: true }) : emptyState({
          icon: ICONS.route, title: 'Поездок пока нет',
          text: 'Нажмите «Старт», когда выходите из дома, или добавьте поездку задним числом.',
          compact: true,
        })}
      </section>

      <section class="reveal" style="margin-top:var(--s-8)" aria-label="Месяц">
        ${sectionTitle('Месяц')}
        <div class="row-between">
          <span class="t-num-lg">${formatMoney(month.current.cost)}</span>
          ${month.costChange != null ? html`<span class="t-caption ${month.costChange > 0 ? 'warn' : 'accent'}">${formatPercent(month.costChange, true)} к тем же дням прошлого месяца</span>` : ''}
        </div>
        <div class="road-progress" role="img" aria-label="Потрачено ${Math.round(share * 100)} % от прошлого месяца">
          <div class="fill" style="width:${share * 100}%"></div><div class="lane"></div>
          ${prevMarker != null ? html`<div class="marker" style="left:${prevMarker * 100}%" title="Прошлый месяц к этой дате"></div>` : ''}
        </div>
        <p class="t-caption">${target > 0
          ? `Прошлый месяц целиком: ${formatMoney(target)} · черта — уровень прошлого месяца к этой дате`
          : `${month.current.trips} поездок · ${formatDuration(month.current.activeMs)} в дороге`}</p>
      </section>

      <section class="reveal" style="margin-top:var(--s-8)">
        ${sectionTitle('Быстрые действия')}
        <div class="quick-actions">
          <button class="quick-action" data-action="quick-add">${ICONS.plus}<span>Добавить поездку</span></button>
          <button class="quick-action" data-action="repeat-last" ${last ? '' : 'disabled'}>${ICONS.repeat}<span>Повторить последнюю</span></button>
          <a class="quick-action" href="#/routes">${ICONS.route}<span>Шаблоны маршрутов</span></a>
        </div>
      </section>`;
  },
  actions: {
    'home-direction': (app, el) => { app.ui.homeDirection = el.dataset.value; app.haptic(); app.rerender(); },
    'repeat-last': (app) => app.quickAdd({ repeat: true }),
  },
};
