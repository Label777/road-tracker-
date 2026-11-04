// История: календарь месяца с итогами по дням, список по дням, фильтры.
import { html } from '../html.js';
import { topBar, card, tripRow, metric, metrics, empty } from '../components.js';
import { formatMoney, parseMoney, moneyToInput } from '../../core/money.js';
import { formatDuration, formatHours, startOfDay, addMonths, periodInterval, addDays, zonedParts } from '../../core/time.js';
import { totalsOf, inInterval, dailyTotals } from '../../core/analytics.js';
import { emptyFilter, matchesFilter, activeFilterCount, monthGrid } from '../../core/editing.js';
import { DIRECTIONS, TRANSPORT, ICONS, formatMonth, formatDayLong, toInputDate, fromInputDate } from '../format.js';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function filtered(app) {
  const f = app.ui.filter;
  const { store } = app;
  return store.liveTrips().filter((t) => t.status === 'completed' && (!activeFilterCount(f) || matchesFilter(f, store.summary(t))));
}

function dayHeader(store, day, trips) {
  const cost = trips.reduce((a, t) => a + store.tripCost(t), 0);
  const ms = trips.reduce((a, t) => a + store.tripActiveMs(t), 0);
  return html`<h3 class="day-header"><span>${formatDayLong(day)}</span><span class="mono">${formatDuration(ms)} · ${formatMoney(cost)}</span></h3>`;
}

function calendar(app, trips) {
  const { store } = app;
  const month = app.ui.month ?? Date.now();
  const grid = monthGrid(month);
  const summaries = trips.map((t) => store.summary(t));
  const daily = dailyTotals(inInterval(summaries, grid));
  const totals = totalsOf(inInterval(summaries, grid));
  const today = startOfDay(Date.now());
  const selected = app.ui.selectedDay ?? today;
  const dayTrips = trips.filter((t) => startOfDay(t.started_at) === selected);

  return html`
    ${card(null, html`
      <div class="cal-head">
        <button class="icon-btn" data-action="month" data-delta="-1" aria-label="Предыдущий месяц">${ICONS.back}</button>
        <strong>${formatMonth(grid.start)}</strong>
        <button class="icon-btn flip" data-action="month" data-delta="1" aria-label="Следующий месяц">${ICONS.back}</button>
      </div>
      <div class="cal">
        ${WEEKDAYS.map((w) => html`<span class="cal-wd">${w}</span>`)}
        ${grid.cells.map((day) => {
          if (day == null) return html`<span></span>`;
          const t = daily.get(day);
          const label = t ? `${formatDayLong(day)}: поездок ${t.trips}, ${formatDuration(t.activeMs)}, ${formatMoney(t.cost)}, контролёров ${t.controllers}` : formatDayLong(day);
          return html`
            <button class="cal-day ${day === selected ? 'sel' : ''} ${day === today ? 'today' : ''}" data-action="select-day" data-day="${day}" aria-label="${label}">
              <span>${zonedParts(day).day}</span>
              ${t ? html`<span class="dots">${Array.from({ length: Math.min(t.trips, 3) }, () => html`<i></i>`)}${t.controllers ? html`<i class="ctrl"></i>` : ''}</span>
                <span class="cal-cost">${Math.round(t.cost / 100) || ''}</span>` : ''}
            </button>`;
        })}
      </div>
      ${metrics(metric(totals.trips, 'поездок'), metric(formatHours(totals.activeMs), 'в пути'), metric(formatMoney(totals.cost), 'расходы'))}
    `)}
    <section class="card">
      ${dayHeader(store, selected, dayTrips)}
      ${dayTrips.length ? html`<div class="list">${dayTrips.map((t) => tripRow(store, t))}</div>` : empty('Поездок нет')}
    </section>`;
}

function list(app, trips) {
  const { store } = app;
  if (!trips.length) return empty(activeFilterCount(app.ui.filter) ? 'Нет поездок по выбранным фильтрам.' : 'Записанные поездки появятся здесь.');
  const groups = new Map();
  for (const t of trips) {
    const day = startOfDay(t.started_at);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(t);
  }
  return html`${[...groups].map(([day, ts]) => html`<section class="card">${dayHeader(store, day, ts)}<div class="list">${ts.map((t) => tripRow(store, t))}</div></section>`)}`;
}

function filterPanel(app) {
  const f = app.ui.filter;
  const routes = app.store.live('routes');
  const check = (group, value, label) => html`<label class="chip-check"><input type="checkbox" data-field="${group}" value="${value}" ${f[group].includes(value) ? 'checked' : ''}><span>${label}</span></label>`;
  return card('Фильтры', html`
    <div class="form">
      <div class="grid2">
        <label>С<input type="date" data-field="from" value="${toInputDate(f.from)}"></label>
        <label>По<input type="date" data-field="to" value="${f.to != null ? toInputDate(addDays(f.to, -1)) : ''}"></label>
      </div>
      <p class="chips">${Object.entries(DIRECTIONS).map(([k, v]) => check('directions', k, v))}</p>
      <p class="chips">${Object.entries(TRANSPORT).map(([k, v]) => check('transports', k, v))}</p>
      <div class="grid2">
        <label>Стоимость от, ₴<input inputmode="decimal" data-field="minCost" value="${moneyToInput(f.minCost)}"></label>
        <label>до, ₴<input inputmode="decimal" data-field="maxCost" value="${moneyToInput(f.maxCost)}"></label>
      </div>
      <label>Контролёры<select data-field="controllers">
        <option value="any" ${f.controllers === 'any' ? 'selected' : ''}>Все поездки</option>
        <option value="met" ${f.controllers === 'met' ? 'selected' : ''}>Был контролёр</option>
        <option value="notMet" ${f.controllers === 'notMet' ? 'selected' : ''}>Без контролёра</option>
      </select></label>
      <div class="grid2">
        <label>Номер маршрута<input data-field="routeNumber" value="${f.routeNumber}" placeholder="720"></label>
        <label>Шаблон<select data-field="routeId"><option value="">Любой</option>${routes.map((r) => html`<option value="${r.id}" ${r.id === f.routeId ? 'selected' : ''}>${r.name}</option>`)}</select></label>
      </div>
      <div class="btn-row"><button class="btn" data-action="reset-filter">Сбросить</button><button class="btn primary" data-action="toggle-filters">Готово</button></div>
    </div>`);
}

export const historyView = {
  tab: 'history',
  render(app) {
    app.ui.filter ??= emptyFilter();
    app.ui.historyMode ??= 'calendar';
    const { store } = app;
    const trips = filtered(app);
    const unconfirmed = store.liveTrips().filter((t) => t.status === 'suggested');
    const n = activeFilterCount(app.ui.filter);
    const mode = app.ui.historyMode;

    return html`
      ${topBar('История', {
        actions: html`
          <button class="icon-btn ${n ? 'badge' : ''}" data-action="toggle-filters" aria-label="Фильтры" data-count="${n || ''}">${ICONS.filter}</button>
          <a class="icon-btn" href="#/new" aria-label="Добавить поездку">${ICONS.plus}</a>`,
      })}
      <div class="stack">
        ${unconfirmed.length ? card('Требуют подтверждения', html`<div class="list">${unconfirmed.map((t) => tripRow(store, t))}</div>`) : ''}
        ${app.ui.showFilters ? filterPanel(app) : ''}
        <div class="segmented">
          <button class="${mode === 'calendar' ? 'on' : ''}" data-action="history-mode" data-value="calendar">Календарь</button>
          <button class="${mode === 'list' ? 'on' : ''}" data-action="history-mode" data-value="list">Список</button>
        </div>
        ${n ? html`<p class="muted small">Фильтров: ${n}. Показано поездок: ${trips.length}.</p>` : ''}
        ${mode === 'calendar' ? calendar(app, trips) : list(app, trips)}
      </div>`;
  },
  onInput(app, el, type) {
    const f = app.ui.filter;
    const key = el.dataset.field;
    if (key === 'directions' || key === 'transports') {
      f[key] = el.checked ? [...f[key], el.value] : f[key].filter((x) => x !== el.value);
    } else if (key === 'from') f.from = fromInputDate(el.value);
    else if (key === 'to') f.to = el.value ? addDays(fromInputDate(el.value), 1) : null;
    else if (key === 'minCost' || key === 'maxCost') {
      const m = el.value.trim() ? parseMoney(el.value) : null;
      el.classList.toggle('invalid', el.value.trim() !== '' && m == null);
      f[key] = m || null;
    } else if (key === 'routeId') f.routeId = el.value || null;
    else f[key] = el.value;
    // Текстовые поля перерисовывают список по завершении ввода, чтобы не терять фокус
    return el.tagName !== 'INPUT' || el.type === 'checkbox' || el.type === 'date' || type === 'change';
  },
  actions: {
    'toggle-filters': (app) => { app.ui.showFilters = !app.ui.showFilters; app.rerender(); },
    'reset-filter': (app) => { app.ui.filter = emptyFilter(); app.rerender(); },
    'history-mode': (app, el) => { app.ui.historyMode = el.dataset.value; app.rerender(); },
    month: (app, el) => {
      app.ui.month = addMonths(app.ui.month ?? Date.now(), +el.dataset.delta);
      app.ui.selectedDay = periodInterval('month', app.ui.month).start;
      app.rerender();
    },
    'select-day': (app, el) => { app.ui.selectedDay = +el.dataset.day; app.rerender(); },
  },
};
