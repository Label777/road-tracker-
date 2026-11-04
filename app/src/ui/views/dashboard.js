import { html } from '../html.js';
import { card, metric, metrics, tripRow, barChart, topBar, empty } from '../components.js';
import { formatMoney } from '../../core/money.js';
import { formatDuration, formatHours, periodInterval, zonedParts } from '../../core/time.js';
import {
  totalsOf, inInterval, monthComparison, averageTripMs, averageTripCost, dailySeries,
} from '../../core/analytics.js';
import { TRANSPORT, ICONS, formatPercent } from '../format.js';

export const suggestedDirection = (now = Date.now()) => (zonedParts(now).hour < 14 ? 'to_work' : 'to_home');

export function startButton(tracker) {
  const s = tracker.session;
  return html`
    <button class="start-btn ${s ? 'recording' : ''}" data-action="${s ? 'open-trip' : 'quick-start'}">
      <span class="start-icon">${s ? ICONS.trip : ICONS.play}</span>
      <span class="start-text">
        <strong>${s ? 'Идёт запись поездки' : 'Начать поездку'}</strong>
        ${s ? html`<span class="mono" data-timer>${formatDuration(tracker.activeMs())}</span>` : html`<span>одним нажатием</span>`}
      </span>
      ${ICONS.chevron}
    </button>`;
}

export const dashboard = {
  tab: 'home',
  render(app) {
    const { store, tracker } = app;
    const now = Date.now();
    const trips = store.completedSummaries();
    const today = totalsOf(inInterval(trips, periodInterval('day', now)));
    const cmp = monthComparison(trips, now);
    const m = cmp.current;
    const month = periodInterval('month', now);
    const series = dailySeries(trips, month);
    const recent = store.liveTrips().slice(0, 5);

    return html`
      ${topBar('Road Tracker')}
      <div class="stack">
        ${startButton(tracker)}
        ${card('Сегодня', html`
          ${metrics(metric(formatDuration(today.activeMs), 'в пути'), metric(formatMoney(today.cost), 'потрачено'))}
          ${metrics(metric(today.trips, 'поездок'), metric(today.transfers, 'пересадок'))}
          ${today.transports.size ? html`<p class="chips">${[...today.transports].map((t) => html`<span class="chip">${TRANSPORT[t]}</span>`)}</p>` : ''}
        `)}
        ${card('Этот месяц', html`
          ${metrics(metric(formatMoney(m.cost), 'расходы'), metric(formatHours(m.activeMs), 'в дороге'))}
          ${metrics(
            metric(averageTripMs(m) != null ? formatDuration(averageTripMs(m)) : '—', 'средняя поездка'),
            metric(averageTripCost(m) != null ? formatMoney(averageTripCost(m)) : '—', 'средняя стоимость'),
          )}
          ${cmp.costChange != null ? html`<p class="muted small">Расходы к прошлому месяцу: ${formatPercent(cmp.costChange, true)}</p>` : ''}
          ${m.trips ? html`
            <h3 class="sub">Расходы по дням</h3>
            ${barChart(series.map((p) => ({ label: zonedParts(p.day).day, title: zonedParts(p.day).day, value: p.cost })), { format: formatMoney })}
            <h3 class="sub">Время в дороге по дням</h3>
            ${barChart(series.map((p) => ({ label: zonedParts(p.day).day, title: zonedParts(p.day).day, value: p.activeMs })), { format: formatDuration })}
          ` : ''}
        `)}
        ${card('Последние поездки', recent.length
          ? html`<div class="list">${recent.map((t) => tripRow(store, t))}</div>`
          : empty('Пока нет поездок. Нажмите «Начать поездку» или добавьте её задним числом во вкладке «История».'))}
      </div>`;
  },
};
