// История: календарь месяца (активность и расходы по дням), подробности дня в шторке,
// список по дням, фильтры в шторке.
import { html } from '../html.js';
import { topBar, iconButton, segmented, tripCard, emptyState, metricCard, metricGrid, primaryButton, secondaryButton } from '../components.js';
import { formatMoney, parseMoney, moneyToInput } from '../../core/money.js';
import { formatDuration, formatHours, startOfDay, addMonths, periodInterval, addDays, zonedParts } from '../../core/time.js';
import { totalsOf, inInterval, dailyTotals } from '../../core/analytics.js';
import { emptyFilter, matchesFilter, activeFilterCount, monthGrid } from '../../core/editing.js';
import { DIRECTIONS, TRANSPORT, ICONS, formatMonth, formatDayLong, toInputDate, fromInputDate } from '../format.js';
import { sheetHeader } from '../sheet.js';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function filtered(app) {
  const f = app.ui.filter;
  const { store } = app;
  const active = activeFilterCount(f);
  return store.liveTrips().filter((t) => t.status === 'completed' && (!active || matchesFilter(f, store.summary(t))));
}

function dayList(app, trips) {
  return trips.length
    ? html`<div>${trips.map((t) => tripCard(app.store, t))}</div>`
    : emptyState({ text: 'В этот день поездок нет.', compact: true });
}

function daySheet(day) {
  return {
    label: formatDayLong(day),
    render: (app) => {
      const trips = filtered(app).filter((t) => startOfDay(t.started_at) === day);
      const s = totalsOf(trips.map((t) => app.store.summary(t)));
      return html`
        ${sheetHeader(formatDayLong(day))}
        ${trips.length ? metricGrid(
          metricCard('В пути', formatDuration(s.activeMs)),
          metricCard('Расходы', formatMoney(s.cost)),
          metricCard('Поездок', String(s.trips), { hint: s.transfers ? `пересадок: ${s.transfers}` : '' }),
          metricCard('Контролёров', String(s.controllers)),
        ) : ''}
        <div style="margin-top:var(--s-4)">${dayList(app, trips)}</div>
        <div style="margin-top:var(--s-4)">${secondaryButton('Добавить поездку в этот день', { action: 'add-on-day', icon: ICONS.plus, 'data-day': day })}</div>`;
    },
    actions: {
      'add-on-day': (app, el) => {
        const d = app.store.emptyDraft();
        const dayStart = +el.dataset.day;
        d.started_at = dayStart + 8 * 3_600_000;
        d.finished_at = d.started_at + 45 * 60_000;
        app.ui.pendingDraft = d;
        app.closeSheet();
        app.navigate('#/new');
      },
    },
  };
}

function calendar(app, trips) {
  const { store } = app;
  const month = app.ui.month ?? Date.now();
  const grid = monthGrid(month);
  const summaries = trips.map((t) => store.summary(t));
  const daily = dailyTotals(inInterval(summaries, grid));
  const totals = totalsOf(inInterval(summaries, grid));
  const maxCost = Math.max(1, ...[...daily.values()].map((t) => t.cost));
  const today = startOfDay(Date.now());
  const selected = app.ui.selectedDay;

  return html`
    <section class="surface reveal">
      <div class="cal-head">
        ${iconButton(ICONS.back, 'Предыдущий месяц', { action: 'month' })}
        <strong aria-live="polite">${formatMonth(grid.start)}</strong>
        <button class="icon-btn" data-action="month" data-delta="1" aria-label="Следующий месяц" style="transform:scaleX(-1)">${ICONS.back}</button>
      </div>
      <div class="cal" role="grid" aria-label="Календарь поездок">
        ${WEEKDAYS.map((w) => html`<span class="cal-wd" aria-hidden="true">${w}</span>`)}
        ${grid.cells.map((day) => {
          if (day == null) return html`<span></span>`;
          const t = daily.get(day);
          const label = t ? `${formatDayLong(day)}: поездок ${t.trips}, ${formatDuration(t.activeMs)}, ${formatMoney(t.cost)}${t.controllers ? `, контролёров ${t.controllers}` : ''}` : `${formatDayLong(day)}: поездок нет`;
          return html`
            <button class="cal-day ${t ? 'has' : ''} ${day === today ? 'today' : ''}" aria-pressed="${day === selected}" data-action="select-day" data-day="${day}" aria-label="${label}">
              <span>${zonedParts(day).day}</span>
              ${t ? html`<span class="cal-cost">${Math.round(t.cost / 100)}</span>
                <span class="heat" style="opacity:${(0.35 + 0.65 * (t.cost / maxCost)).toFixed(2)}"></span>
                ${t.controllers ? html`<span class="ctrl" aria-hidden="true"></span>` : ''}` : ''}
            </button>`;
        })}
      </div>
    </section>
    <section class="reveal">
      ${metricGrid(
        metricCard('Поездок', String(totals.trips)),
        metricCard('В пути', formatHours(totals.activeMs)),
        metricCard('Расходы', formatMoney(totals.cost)),
        metricCard('Контролёров', String(totals.controllers)),
      )}
      <p class="t-caption" style="margin-top:var(--s-3)">Нажмите на день, чтобы увидеть поездки. Яркость полосы — расходы, оранжевая точка — встреча с контролёром.</p>
    </section>`;
}

function list(app, trips) {
  if (!trips.length) {
    return emptyState({
      icon: ICONS.history,
      title: activeFilterCount(app.ui.filter) ? 'Ничего не найдено' : 'История пуста',
      text: activeFilterCount(app.ui.filter) ? 'Измените или сбросьте фильтры.' : 'Записанные поездки появятся здесь.',
      action: activeFilterCount(app.ui.filter) ? secondaryButton('Сбросить фильтры', { action: 'reset-filter', size: 'sm' }) : '',
    });
  }
  const groups = new Map();
  for (const t of trips) {
    const day = startOfDay(t.started_at);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(t);
  }
  return html`${[...groups].map(([day, ts]) => {
    const cost = ts.reduce((a, t) => a + app.store.tripCost(t), 0);
    return html`<section class="reveal">
      <div class="section-title"><h2>${formatDayLong(day)}</h2><span class="t-caption">${formatMoney(cost)}</span></div>
      ${dayList(app, ts)}</section>`;
  })}`;
}

const filterSheet = {
  label: 'Фильтры',
  render: (app) => {
    const f = app.ui.filter;
    const routes = app.store.live('routes');
    const toggle = (group, value, label) => html`<button class="chip" aria-pressed="${f[group].includes(value)}" data-action="filter-toggle" data-group="${group}" data-value="${value}">${label}</button>`;
    return html`
      ${sheetHeader('Фильтры', activeFilterCount(f) ? html`<button class="btn btn-ghost btn-sm" data-action="reset-filter">Сбросить</button>` : '')}
      <div class="stack">
        <div class="grid-2">
          <label class="field"><span>С</span><input type="date" data-field="from" value="${toInputDate(f.from)}"></label>
          <label class="field"><span>По</span><input type="date" data-field="to" value="${f.to != null ? toInputDate(addDays(f.to, -1)) : ''}"></label>
        </div>
        <div><span class="field-label">Направление</span><div class="chips" style="margin-top:6px">${Object.entries(DIRECTIONS).map(([k, v]) => toggle('directions', k, v))}</div></div>
        <div><span class="field-label">Транспорт</span><div class="chips" style="margin-top:6px">${Object.entries(TRANSPORT).map(([k, v]) => toggle('transports', k, v))}</div></div>
        <div class="grid-2">
          <label class="field"><span>Стоимость от, ₴</span><input inputmode="decimal" data-field="minCost" value="${moneyToInput(f.minCost)}"></label>
          <label class="field"><span>до, ₴</span><input inputmode="decimal" data-field="maxCost" value="${moneyToInput(f.maxCost)}"></label>
        </div>
        <div><span class="field-label">Контролёры</span><div style="margin-top:6px">${segmented({ any: 'Все', met: 'Был', notMet: 'Не было' }, f.controllers, { action: 'filter-controllers', label: 'Контролёры' })}</div></div>
        <div class="grid-2">
          <label class="field"><span>Номер маршрута</span><input data-field="routeNumber" value="${f.routeNumber}" placeholder="720"></label>
          <label class="field"><span>Шаблон</span><select data-field="routeId"><option value="">Любой</option>${routes.map((r) => html`<option value="${r.id}" ${r.id === f.routeId ? 'selected' : ''}>${r.name}</option>`)}</select></label>
        </div>
        ${primaryButton(`Показать: ${filtered(app).length}`, { action: 'sheet-close', size: 'lg' })}
      </div>`;
  },
  onInput: (app, el, type) => {
    const f = app.ui.filter;
    const key = el.dataset.field;
    if (key === 'from') f.from = fromInputDate(el.value);
    else if (key === 'to') f.to = el.value ? addDays(fromInputDate(el.value), 1) : null;
    else if (key === 'minCost' || key === 'maxCost') {
      const m = el.value.trim() ? parseMoney(el.value) : null;
      el.classList.toggle('invalid', el.value.trim() !== '' && m == null);
      f[key] = m || null;
    } else if (key === 'routeId') f.routeId = el.value || null;
    else f[key] = el.value;
    app.rerender();
    return el.tagName === 'SELECT' || el.type === 'date' || type === 'change';
  },
  actions: {
    'filter-toggle': (app, el) => {
      const { group, value } = el.dataset;
      const f = app.ui.filter;
      f[group] = f[group].includes(value) ? f[group].filter((x) => x !== value) : [...f[group], value];
      app.haptic();
      app.renderSheet();
      app.rerender();
    },
    'filter-controllers': (app, el) => { app.ui.filter.controllers = el.dataset.value; app.renderSheet(); app.rerender(); },
    'reset-filter': (app) => { app.ui.filter = emptyFilter(); app.renderSheet(); app.rerender(); },
  },
};

export const historyView = {
  tab: 'history',
  render(app) {
    app.ui.filter ??= emptyFilter();
    app.ui.historyMode ??= 'calendar';
    const trips = filtered(app);
    const unconfirmed = app.store.liveTrips().filter((t) => t.status === 'suggested');
    const n = activeFilterCount(app.ui.filter);
    const mode = app.ui.historyMode;

    return html`
      ${topBar('История', {
        large: true,
        actions: html`
          ${iconButton(ICONS.filter, n ? `Фильтры: ${n}` : 'Фильтры', { action: 'open-filters', count: n || '' })}
          ${iconButton(ICONS.plus, 'Добавить поездку', { action: 'quick-add' })}`,
      })}
      <div class="stack-lg">
        ${unconfirmed.length ? html`<section><div class="section-title"><h2>Требуют подтверждения</h2></div>${unconfirmed.map((t) => tripCard(app.store, t))}</section>` : ''}
        <div class="stack">
          ${segmented({ calendar: 'Календарь', list: 'Список' }, mode, { action: 'history-mode', label: 'Вид' })}
          ${n ? html`<div class="row-between"><span class="t-caption">Фильтров: ${n} · поездок: ${trips.length}</span><button class="btn btn-ghost btn-sm" data-action="reset-filter">Сбросить</button></div>` : ''}
        </div>
        ${mode === 'calendar' ? calendar(app, trips) : list(app, trips)}
      </div>`;
  },
  actions: {
    'open-filters': (app) => app.openSheet(filterSheet),
    'reset-filter': (app) => { app.ui.filter = emptyFilter(); app.rerender(); },
    'history-mode': (app, el) => { app.ui.historyMode = el.dataset.value; app.haptic(); app.rerender(); },
    month: (app, el) => {
      app.ui.month = addMonths(app.ui.month ?? Date.now(), +(el.dataset.delta ?? -1));
      app.ui.selectedDay = null;
      app.rerender();
    },
    'select-day': (app, el) => {
      const day = +el.dataset.day;
      app.ui.selectedDay = day;
      app.haptic();
      app.rerender();
      app.openSheet(daySheet(day));
    },
  },
};

export { periodInterval };
