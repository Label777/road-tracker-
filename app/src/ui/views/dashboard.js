// Главная — «пульт»: на первом экране (даже iPhone SE) старт, «Обычная поездка» в одно
// касание и расходы сегодня/за месяц. Ниже — шаблоны, последняя поездка, месяц с бюджетом.
import { html } from '../html.js';
import { tripCard, trackingStatus, emptyState, sectionTitle, notice, primaryButton, secondaryButton } from '../components.js';
import { formatMoney, parseMoney, moneyToInput } from '../../core/money.js';
import { formatDuration, periodInterval, zonedParts } from '../../core/time.js';
import { totalsOf, inInterval, monthToDateComparison, averageTripMs, monthBudget } from '../../core/analytics.js';
import { backupDue } from '../../core/backup.js';
import { DIRECTIONS, ICONS, TRANSPORT, TRANSPORT_ICONS, LOCALE, formatPercent, formatClock, formatTime, formatMonth } from '../format.js';
import { gpsPermission } from '../permissions.js';
import { sheetHeader } from '../sheet.js';
import { suggestedDirection, startTrip, recordUsual, usualToday } from '../actions.js';
import { saveBackup } from '../backup.js';
import { openStartSheet } from './start-sheet.js';
import { staleNotice } from '../stale.js';

export { suggestedDirection };

/**
 * «Старт» на главной: шторка «На чём едете?» (транспорт и цена), затем запуск
 * с анимацией и переход на экран поездки.
 */
export function quickStart(app, direction = app.ui.homeDirection ?? suggestedDirection()) {
  app.haptic();
  return openStartSheet(app, direction, {
    onStarted: () => {
      document.querySelector('.start-orb')?.classList.add('launch');
      setTimeout(() => app.navigate('#/trip'), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 380);
    },
  });
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

function startOrb(app, dir) {
  const s = app.tracker.session;
  if (s) {
    return html`
      <button class="start-orb recording" data-action="open-trip" aria-label="Идёт запись поездки, открыть">
        <svg class="ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="48"/></svg>
        <span class="label"><strong data-timer="clock">${formatClock(app.tracker.activeMs())}</strong><span>${s.pausedSince ? 'на паузе' : 'идёт запись'}</span></span>
      </button>`;
  }
  return html`
    <button class="start-orb" data-action="quick-start" aria-label="Начать поездку: ${DIRECTIONS[dir]}">
      <svg class="ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="48"/></svg>
      <span class="label">${ICONS.play}<strong>Старт</strong><span>${DIRECTIONS[dir].toLowerCase()}</span></span>
    </button>`;
}

const segmentsText = (segments) => segments.filter((s) => s.transport !== 'walk')
  .map((s) => (s.number ? `${TRANSPORT[s.transport]} ${s.number}` : TRANSPORT[s.transport])).join(' → ') || 'без этапов';

/** «Обычная поездка»: всё, что будет записано, видно до касания. */
function usualCard(app, dir) {
  const u = usualToday(app, dir);
  if (!u) return '';
  const first = u.segments.find((s) => s.transport !== 'walk') ?? u.segments[0];
  return html`
    <button class="usual-card ${u.logged ? 'done' : ''}" data-action="record-usual" data-direction="${dir}"
      aria-label="Записать обычную поездку: ${DIRECTIONS[dir]}, ${formatTime(u.start)}–${formatTime(u.end)}, ${formatMoney(u.cost)}">
      <span class="glyph ${first ? `tr-${first.transport}` : ''}">${first ? TRANSPORT_ICONS[first.transport] : ICONS.route}</span>
      <span class="main">
        <span class="title">Обычная поездка</span>
        <span class="sub">${DIRECTIONS[dir].toLowerCase()} · ${formatTime(u.start)}–${formatTime(u.end)} · ${segmentsText(u.segments)}</span>
      </span>
      <span class="end"><span class="t-num">${formatMoney(u.cost)}</span><span class="t-caption">${u.logged ? 'уже есть' : 'записать'}</span></span>
    </button>`;
}

function summaryStrip(app, now) {
  const trips = app.store.completedSummaries();
  const today = totalsOf(inInterval(trips, periodInterval('day', now)));
  const budget = monthBudget(trips, app.settings().budget, now);
  const month = monthToDateComparison(trips, now);
  const monthName = formatMonth(now).split(' ')[0];
  let monthHint = `${month.current.trips} поездок`;
  if (budget) monthHint = budget.left >= 0 ? `осталось ${formatMoney(budget.left)}` : `сверх бюджета ${formatMoney(-budget.left)}`;
  else if (month.costChange != null) monthHint = `${formatPercent(month.costChange, true)} к тем же дням прошлого`;
  return html`
    <div class="summary-strip" aria-label="Расходы">
      <a href="#/history"><span class="t-caption">Сегодня</span><span class="t-num-lg">${formatMoney(today.cost)}</span>
        <span class="t-caption">${today.trips ? `${formatDuration(today.activeMs)} в пути` : 'поездок нет'}</span></a>
      <a href="#/analytics"><span class="t-caption">${monthName}</span><span class="t-num-lg">${formatMoney(month.current.cost)}</span>
        <span class="t-caption ${budget?.verdict === 'over' ? 'error' : budget?.verdict === 'risk' ? 'warn' : ''}">${monthHint}</span></a>
    </div>`;
}

function monthSection(app, now) {
  const trips = app.store.completedSummaries();
  const month = monthToDateComparison(trips, now);
  const budget = monthBudget(trips, app.settings().budget, now);
  const avg = averageTripMs(month.current);
  const avgLine = avg != null ? ` · средняя поездка ${formatDuration(avg)}` : '';

  if (budget) {
    const verdict = {
      over: html`<span class="error">Бюджет превышен на ${formatMoney(budget.overBy)}.</span>`,
      risk: html`<span class="warn">При таком темпе выйдет ${formatMoney(budget.projected)} — на ${formatMoney(budget.overBy)} больше бюджета.</span>`,
      within: html`<span class="accent">Уложитесь: прогноз ${formatMoney(budget.projected)}.</span>`,
      unknown: 'Прогноз появится после 5 дней с поездками.',
    }[budget.verdict];
    return html`
      <div class="row-between">
        <span class="t-num-lg">${formatMoney(budget.spent)} <span class="t-callout muted">из ${formatMoney(budget.budget)}</span></span>
        <button class="btn btn-ghost btn-sm" data-action="open-budget">Изменить</button>
      </div>
      <div class="road-progress ${budget.share > 1 ? 'over' : ''}" role="img" aria-label="Потрачено ${Math.round(budget.share * 100)} % бюджета месяца">
        <div class="fill" style="width:${Math.min(1, budget.share) * 100}%"></div><div class="lane"></div>
        ${budget.projected != null ? html`<div class="marker" style="left:${Math.min(1, budget.projected / budget.budget) * 100}%" title="Прогноз на конец месяца"></div>` : ''}
      </div>
      <p class="t-callout">${verdict}</p>
      <p class="t-caption">${budget.perWeekday != null ? `Можно тратить ${formatMoney(budget.perWeekday)} в каждый из ${budget.weekdaysLeft} оставшихся будних дней` : `${month.current.trips} поездок в этом месяце`}${avgLine}. Черта — прогноз на конец месяца.</p>`;
  }

  const target = month.previousFull.cost;
  const share = target > 0 ? Math.min(1, month.current.cost / target) : (month.current.cost > 0 ? 1 : 0);
  const prevMarker = target > 0 ? Math.min(1, month.previous.cost / target) : null;
  return html`
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
      : `${month.current.trips} поездок · ${formatDuration(month.current.activeMs)} в дороге`}${avgLine}</p>
    <button class="btn btn-secondary btn-sm" style="margin-top:var(--s-3)" data-action="open-budget">${ICONS.target}Задать бюджет на месяц</button>`;
}

export const budgetSheet = {
  label: 'Бюджет на месяц',
  render: (app) => {
    const cur = app.settings().budget;
    return html`
      ${sheetHeader('Бюджет на дорогу')}
      <p class="t-callout muted" style="margin-bottom:var(--s-4)">Сколько вы готовы тратить на проезд в месяц. На главной будет видно, сколько осталось и уложитесь ли вы при текущем темпе.</p>
      <form data-action="save-budget" class="stack">
        <label class="field" style="margin:0"><span>В месяц</span>
          <span class="input-affix"><input class="numeric-input" name="budget" inputmode="decimal" value="${cur ? moneyToInput(cur) : ''}" placeholder="0" autocomplete="off"><span class="affix">₴</span></span></label>
        <div class="btn-row">
          ${cur ? secondaryButton('Убрать бюджет', { action: 'clear-budget' }) : ''}
          ${primaryButton('Сохранить', { type: 'submit' })}
        </div>
      </form>`;
  },
  actions: {
    'save-budget': async (app, form) => {
      const v = parseMoney(String(new FormData(form).get('budget') || ''));
      if (!v) { app.toast('Введите сумму больше нуля'); return; }
      await app.saveSettings({ budget: v });
      app.haptic('success');
      app.closeSheet();
    },
    'clear-budget': async (app) => {
      await app.saveSettings({ budget: null });
      app.closeSheet();
    },
  },
};

function backupNotice(app, now) {
  const { store } = app;
  const trips = store.liveTrips();
  const due = backupDue({
    trips: trips.length, lastBackupAt: store.meta('lastBackupAt'), firstTripAt: trips.at(-1)?.created_at ?? null,
    cloud: !!app.client?.user, now,
  });
  if (!due || app.ui.backupDismissed) return '';
  return html`<div class="notice warning" role="status"><div class="body">
    <div class="t-callout">Данные хранятся только в этом браузере, а копии больше недели. Safari может удалить данные сайта, которым долго не пользовались.</div>
    <div class="actions"><button class="btn btn-primary btn-sm" data-action="backup-now">Сохранить копию</button>
      <button class="btn btn-ghost btn-sm" data-action="backup-later">Позже</button></div></div></div>`;
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
    const recording = !!tracker.session;
    const dir = app.ui.homeDirection ?? suggestedDirection(now);
    const gps = app.ui.startGps ?? app.settings().gpsByDefault;
    const last = store.liveTrips().find((t) => t.status === 'completed');
    const routes = store.live('routes').sort((a, b) => a.name.localeCompare(b.name));
    const dateText = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' }).format(now);

    return html`
      <header class="greeting compact">
        <div class="row-between">
          <span class="brand">${ICONS.logo}ROAD TRACKER</span>
          ${gpsBadge(app)}
        </div>
        <p class="date"><b>${greeting(now)}</b> · ${dateText}</p>
      </header>

      ${recording ? staleNotice(app, now) : ''}
      <section class="hero">
        ${startOrb(app, dir)}
        ${recording ? html`<p class="t-caption">Нажмите, чтобы открыть поездку</p>` : html`
          <div class="hero-sub" role="group" aria-label="Направление и GPS">
            ${['to_work', 'to_home'].map((k) => html`<button class="chip ${k === dir ? 'on' : ''}" aria-pressed="${k === dir}" data-action="home-direction" data-value="${k}">${DIRECTIONS[k]}</button>`)}
            <button class="chip ${gps ? 'on' : ''}" aria-pressed="${gps}" data-action="toggle-gps" aria-label="Записывать маршрут по GPS">${ICONS.gps}GPS</button>
          </div>`}
      </section>

      ${recording ? '' : usualCard(app, dir)}
      ${notice(tracker.notice, tracker.notice?.kind === 'suggest' ? html`<button class="btn btn-primary btn-sm" data-action="open-trip">Открыть</button>` : '')}
      ${summaryStrip(app, now)}
      ${backupNotice(app, now)}

      ${!recording && routes.length ? html`<section class="reveal" style="margin-top:var(--s-8)">
        ${sectionTitle('Старт по шаблону', html`<a href="#/routes">Изменить</a>`)}
        <div class="chips scroll">${routes.map((r) => html`
          <button class="chip" data-action="start-template" data-id="${r.id}">${r.direction === 'to_home' ? ICONS.home : ICONS.work}${r.name}</button>`)}</div>
      </section>` : ''}

      <section class="reveal" style="margin-top:var(--s-8)">
        ${sectionTitle('Последняя поездка', html`<a href="#/history">Вся история</a>`)}
        ${last ? tripCard(store, last, { featured: true }) : emptyState({
          icon: ICONS.route, title: 'Поездок пока нет',
          text: 'Нажмите «Старт», когда выходите, или «Добавить» внизу — для поездки задним числом. После первой поездки появится «Обычная поездка» в одно касание.',
          compact: true,
        })}
      </section>

      <section class="reveal" style="margin-top:var(--s-8)" aria-label="Месяц">
        ${sectionTitle(formatMonth(now))}
        ${monthSection(app, now)}
      </section>

      <section class="reveal" style="margin-top:var(--s-8)">
        ${sectionTitle('Ещё')}
        <div class="quick-actions">
          <button class="quick-action" data-action="repeat-last" ${last ? '' : 'disabled'}>${ICONS.repeat}<span>Повторить последнюю</span></button>
          <a class="quick-action" href="#/routes">${ICONS.route}<span>Шаблоны маршрутов</span></a>
          <a class="quick-action" href="#/shortcuts">${ICONS.bolt}<span>Команды iPhone</span></a>
        </div>
      </section>`;
  },
  actions: {
    'home-direction': (app, el) => { app.ui.homeDirection = el.dataset.value; app.haptic(); app.rerender(); },
    'toggle-gps': (app) => { app.ui.startGps = !(app.ui.startGps ?? app.settings().gpsByDefault); app.haptic(); app.rerender(); },
    'repeat-last': (app) => app.quickAdd({ repeat: true }),
    'record-usual': (app, el) => recordUsual(app, el.dataset.direction),
    'start-template': async (app, el) => {
      app.haptic('success');
      await startTrip(app, { routeId: el.dataset.id });
      app.navigate('#/trip');
    },
    'open-budget': (app) => app.openSheet(budgetSheet),
    'backup-now': (app) => saveBackup(app),
    'backup-later': (app) => { app.ui.backupDismissed = true; app.rerender(); },
  },
};
