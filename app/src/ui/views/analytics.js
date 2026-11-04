// Аналитика: расходы за период, по направлениям и транспорту, прогноз, контролёры, калькулятор экономии.
import { html } from '../html.js';
import { topBar, card, metric, metrics, barChart, empty } from '../components.js';
import { formatMoney, parseMoney, moneyToInput } from '../../core/money.js';
import { formatDuration, formatHours, periodInterval, zonedParts } from '../../core/time.js';
import {
  totalsOf, inInterval, costByDirection, costByTransport, dailySeries, averageCommuteDayCost, forecast,
  compareRoutes, projectSavings, averageTripMs,
} from '../../core/analytics.js';
import { inspectionStats } from '../../core/inspections.js';
import { TRANSPORT, OUTCOME_LABELS, RELIABILITY, formatPercent } from '../format.js';

const PERIODS = { week: 'Неделя', month: 'Месяц', year: 'Год' };

function proportionText(p) {
  if (!p.trials) return 'нет данных';
  const ci = p.interval;
  return `${formatPercent(p.estimate)} (95 %: ${formatPercent(ci.low)}–${formatPercent(ci.high)}, n = ${p.trials})`;
}

function inspectionsCard(app) {
  const { store } = app;
  const obs = [];
  for (const trip of store.liveTrips()) {
    if (trip.status !== 'completed') continue;
    const segs = store.segmentsOf(trip.id);
    for (const i of store.inspectionsOf(trip.id)) {
      const seg = segs.find((s) => s.id === i.segment_id);
      obs.push({ outcome: i.outcome, observedAt: i.observed_at, transport: seg?.transport_type, route: seg?.transport_number || undefined });
    }
  }
  if (!obs.length) return card('Контролёры', empty('Отмечайте контролёров на этапах поездки — здесь появится статистика. Отмечайте и поездки без контролёра, иначе доли будут завышены.'));
  const st = inspectionStats(obs);
  const rows = (map, label) => [...map].sort((a, b) => b[1].trials - a[1].trials).slice(0, 8)
    .map(([k, p]) => html`<tr><td>${label(k)}</td><td class="mono">${proportionText(p)}</td></tr>`);
  return card('Контролёры', html`
    ${metrics(metric(st.encounters, 'встреч'), metric(st.checks, 'проверок'), metric(st.total, 'наблюдений'))}
    <p>Контролёр встречался: <strong>${proportionText(st.encounterRate)}</strong></p>
    <p>Билет проверяли: <strong>${proportionText(st.checkRate)}</strong></p>
    <p class="badge-line rel-${st.checkRate.reliability}">${RELIABILITY[st.checkRate.reliability]}</p>
    <p class="muted small">Это доля в ваших отметках, а не вероятность проверки в будущем: отметки неслучайны, а при малой выборке интервал очень широк.</p>
    <details><summary>Подробнее</summary>
      <table class="table"><tbody>
        ${Object.entries(st.counts).map(([k, n]) => html`<tr><td>${OUTCOME_LABELS[k]}</td><td class="mono">${n}</td></tr>`)}
      </tbody></table>
      <h3 class="sub">Проверки по часам</h3>
      <table class="table"><tbody>${rows(new Map([...st.byHour].sort((a, b) => a[0] - b[0])), (h) => `${String(h).padStart(2, '0')}:00`)}</tbody></table>
      <h3 class="sub">По маршрутам</h3>
      <table class="table"><tbody>${rows(st.byRoute, (r) => (r === '—' ? 'без номера' : `№${r}`))}</tbody></table>
      <h3 class="sub">По транспорту</h3>
      <table class="table"><tbody>${rows(st.byTransport, (t) => TRANSPORT[t] || t)}</tbody></table>
    </details>`);
}

function savingsCard(app) {
  const c = app.ui.calc ??= { aMin: 35, aCost: 3000, bMin: 50, bCost: 1800, trips: 44 };
  const r = compareRoutes({ name: 'А', minutes: c.aMin, cost: c.aCost }, { name: 'Б', minutes: c.bMin, cost: c.bCost });
  let result;
  if (r.verdict === 'identical') result = html`<p>Маршруты равноценны.</p>`;
  else if (r.verdict === 'dominates') result = html`<p>Маршрут ${r.winner} и не дороже, и не медленнее — выбор очевиден.</p>`;
  else {
    const m = projectSavings(r, c.trips);
    result = html`
      <p>Маршрут ${r.cheaper} экономит ${formatMoney(r.saved)}, но дольше на ${r.minutesLost} мин.</p>
      <p class="accent big">Минута стоит ${formatMoney(r.perMinute)}</p>
      <p class="muted small">За месяц (${c.trips} поездок): ${formatMoney(m.money)} экономии и ${m.hours.toFixed(1).replace('.', ',')} ч в дороге дополнительно.</p>`;
  }
  return card('Калькулятор экономии', html`
    <div class="form" id="calc">
      <div class="grid3"><span>Маршрут А</span>
        <label>мин<input inputmode="numeric" data-field="aMin" value="${c.aMin}"></label>
        <label>₴<input inputmode="decimal" data-field="aCost" value="${moneyToInput(c.aCost)}"></label></div>
      <div class="grid3"><span>Маршрут Б</span>
        <label>мин<input inputmode="numeric" data-field="bMin" value="${c.bMin}"></label>
        <label>₴<input inputmode="decimal" data-field="bCost" value="${moneyToInput(c.bCost)}"></label></div>
      <label>Поездок в месяц<input inputmode="numeric" data-field="trips" value="${c.trips}"></label>
    </div>
    <div id="calc-result">${result}</div>`);
}

export const analyticsView = {
  tab: 'analytics',
  render(app) {
    const period = app.ui.period ?? 'month';
    const now = Date.now();
    const all = app.store.completedSummaries();
    const interval = periodInterval(period, now);
    const trips = inInterval(all, interval);
    const t = totalsOf(trips);
    const byDir = costByDirection(trips);
    const byTransport = Object.entries(costByTransport(trips)).sort((a, b) => b[1] - a[1]);
    const fMonth = forecast(all, 'month', now);
    const fYear = forecast(all, 'year', now);
    const series = period === 'year'
      ? Array.from({ length: 12 }, (_, i) => {
        const m = inInterval(trips, periodInterval('month', Date.UTC(zonedParts(now).year, i, 15)));
        return { label: i + 1, title: `Месяц ${i + 1}`, value: totalsOf(m).cost };
      })
      : dailySeries(all, interval).map((p) => ({ label: zonedParts(p.day).day, title: zonedParts(p.day).day, value: p.cost }));

    return html`
      ${topBar('Аналитика')}
      <div class="stack">
        <div class="segmented">${Object.entries(PERIODS).map(([k, v]) => html`<button class="${k === period ? 'on' : ''}" data-action="period" data-value="${k}">${v}</button>`)}</div>
        ${card('Расходы', html`
          ${metrics(metric(formatMoney(t.cost), 'всего'), metric(averageCommuteDayCost(trips) != null ? formatMoney(averageCommuteDayCost(trips)) : '—', 'в среднем за день'))}
          ${metrics(metric(formatHours(t.activeMs), 'в дороге'), metric(averageTripMs(t) != null ? formatDuration(averageTripMs(t)) : '—', 'средняя поездка'))}
          ${t.trips ? barChart(series, { format: formatMoney }) : empty('Нет поездок за период')}
        `)}
        ${card('По направлению', metrics(metric(formatMoney(byDir.to_work || 0), 'на работу'), metric(formatMoney(byDir.to_home || 0), 'домой')))}
        ${card('По видам транспорта', byTransport.length
          ? html`<table class="table"><tbody>${byTransport.map(([k, v]) => html`<tr><td>${TRANSPORT[k]}</td><td class="mono">${formatMoney(v)}</td></tr>`)}</tbody></table>`
          : empty('Нет данных за период'))}
        ${card('Прогноз', fMonth && fYear ? html`
          ${metrics(metric(formatMoney(fMonth.projected), 'до конца месяца'), metric(formatMoney(fYear.projected), 'до конца года'))}
          <p class="muted small">По ${fMonth.basedOnDays} дням поездок за 8 недель: ${formatMoney(fMonth.averagePerDay)} в день, поездки в ${formatPercent(fMonth.rate)} будних дней.</p>`
          : empty('Прогноз появится после 5 дней с поездками — иначе он был бы случайным.'))}
        ${inspectionsCard(app)}
        ${savingsCard(app)}
      </div>`;
  },
  onInput(app, el) {
    const c = app.ui.calc;
    const key = el.dataset.field;
    const v = key.endsWith('Cost') ? parseMoney(el.value) : Number(el.value);
    const ok = v != null && Number.isFinite(v) && v >= 0 && (key.endsWith('Cost') || v > 0);
    el.classList.toggle('invalid', !ok);
    if (!ok) return false;
    c[key] = v;
    const fresh = savingsCard(app).toString();
    const tmp = document.createElement('div');
    tmp.innerHTML = fresh;
    el.closest('main').querySelector('#calc-result').replaceWith(tmp.querySelector('#calc-result'));
    return false;
  },
  actions: {
    period: (app, el) => { app.ui.period = el.dataset.value; app.rerender(); },
  },
};
