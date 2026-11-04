// Аналитика: расходы и время в дороге (интерактивные графики), транспорт, сравнение
// реальных маршрутов, контролёры, прогноз, калькулятор «деньги против времени».
import { html } from '../html.js';
import { topBar, segmented, chartContainer, expenseCard, emptyState, metricCard, metricGrid, sectionTitle } from '../components.js';
import { formatMoney, parseMoney, moneyToInput } from '../../core/money.js';
import { formatDuration, formatHours, periodInterval, zonedParts, HOUR } from '../../core/time.js';
import {
  totalsOf, inInterval, costByDirection, costByTransport, dailySeries, averageCommuteDayCost, forecast,
  compareRoutes, projectSavings, averageTripMs, routeStats, segmentSignature,
} from '../../core/analytics.js';
import { inspectionStats } from '../../core/inspections.js';
import { TRANSPORT, TRANSPORT_ICONS, OUTCOME_LABELS, RELIABILITY, ICONS, formatPercent, LOCALE } from '../format.js';

const PERIODS = { week: 'Неделя', month: 'Месяц', year: 'Год' };
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const PALETTE = ['#2ef07a', '#7cc4ff', '#ffb547', '#c792ff', '#ff7a90', '#5de0d2', '#8d949e'];
const dayTitle = (ms) => new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric', month: 'long' }).format(ms);
const pct = (x) => formatPercent(x);

function series(all, period, now) {
  const interval = periodInterval(period, now);
  if (period === 'year') {
    const year = zonedParts(now).year;
    return Array.from({ length: 12 }, (_, i) => {
      const t = totalsOf(inInterval(all, periodInterval('month', Date.UTC(year, i, 15))));
      return { label: MONTHS[i], title: `${MONTHS[i]} ${year}`, cost: t.cost, ms: t.activeMs };
    });
  }
  return dailySeries(all, interval).map((p) => ({
    label: period === 'week' ? ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'][zonedParts(p.day).weekday - 1] : zonedParts(p.day).day,
    title: dayTitle(p.day), cost: p.cost, ms: p.activeMs,
  }));
}

function transportSection(trips) {
  const items = Object.entries(costByTransport(trips)).sort((a, b) => b[1] - a[1]);
  const sum = items.reduce((a, [, v]) => a + v, 0);
  if (!sum) return emptyState({ text: 'Нет расходов за период.', compact: true });
  return html`
    <div class="stacked" role="img" aria-label="Доли расходов по транспорту">
      ${items.map(([k, v], i) => html`<i style="width:${(v / sum) * 100}%;background:${PALETTE[i % PALETTE.length]};animation-delay:${i * 60}ms" title="${TRANSPORT[k]}"></i>`)}
    </div>
    ${items.map(([k, v], i) => expenseCard({
      icon: html`<span style="color:${PALETTE[i % PALETTE.length]}">${TRANSPORT_ICONS[k]}</span>`,
      label: TRANSPORT[k], value: formatMoney(v), hint: pct(v / sum), share: v / sum,
    }))}`;
}

function routesSection(app, trips) {
  const { store } = app;
  const label = (t) => {
    if (t.routeId) {
      const r = store.data.routes.get(t.routeId);
      if (r) return { key: `r:${r.id}`, label: r.name };
    }
    const sig = segmentSignature(t);
    const text = t.segments.filter((s) => s.transport !== 'walk')
      .map((s) => (s.number ? `${TRANSPORT[s.transport]} ${s.number}` : TRANSPORT[s.transport])).join(' → ') || 'Без этапов';
    return { key: `s:${t.direction}:${sig}`, label: text };
  };
  const stats = routeStats(trips, label).filter((r) => r.count >= 2).slice(0, 4);
  if (!stats.length) {
    return emptyState({ text: 'Сравнение появится, когда по одному маршруту наберётся хотя бы две поездки.', compact: true });
  }
  const [a, b] = stats;
  const cmp = b ? compareRoutes({ name: a.label, minutes: a.avgMs / 60_000, cost: a.avgCost }, { name: b.label, minutes: b.avgMs / 60_000, cost: b.avgCost }) : null;
  return html`
    <div class="compare">
      ${[a, b].filter(Boolean).map((r) => html`
        <div class="${cmp?.winner === r.label ? 'win' : ''}">
          <div class="t-caption" style="min-height:2.6em">${r.label}</div>
          <div class="t-num-lg">${formatDuration(r.avgMs)}</div>
          <div class="t-num">${formatMoney(r.avgCost)}</div>
          <div class="t-caption">поездок: ${r.count}</div>
        </div>`)}
    </div>
    ${cmp ? html`<p class="t-callout" style="margin-top:var(--s-3)">${cmp.verdict === 'tradeoff'
      ? html`«${cmp.cheaper}» дешевле на ${formatMoney(cmp.saved)}, но дольше на ${Math.round(cmp.minutesLost)} мин — минута экономии стоит <b class="accent">${formatMoney(cmp.perMinute)}</b>.`
      : cmp.verdict === 'dominates' ? html`«${cmp.winner}» в среднем и быстрее, и не дороже.` : 'Маршруты в среднем равноценны.'}</p>` : ''}
    ${stats.length > 2 ? html`<div style="margin-top:var(--s-3)">${stats.slice(2).map((r) => expenseCard({ icon: ICONS.route, label: r.label, value: formatMoney(r.avgCost), hint: `${formatDuration(r.avgMs)} · ${r.count}` }))}</div>` : ''}
    <p class="t-caption" style="margin-top:var(--s-2)">Средние значения по вашим поездкам за период.</p>`;
}

function ciBar(p) {
  if (!p.trials) return '';
  return html`<div class="ci-bar" role="img" aria-label="Оценка ${pct(p.estimate)}, 95 % интервал ${pct(p.interval.low)}–${pct(p.interval.high)}">
    <div class="range" style="left:${p.interval.low * 100}%;width:${(p.interval.high - p.interval.low) * 100}%"></div>
    <div class="point" style="left:${p.estimate * 100}%"></div></div>`;
}

function inspectionsSection(app, period, now) {
  const { store } = app;
  const interval = periodInterval(period, now);
  const obs = [];
  for (const trip of store.liveTrips()) {
    if (trip.status !== 'completed' || trip.started_at < interval.start || trip.started_at >= interval.end) continue;
    const segs = store.segmentsOf(trip.id);
    for (const i of store.inspectionsOf(trip.id)) {
      const seg = segs.find((s) => s.id === i.segment_id);
      obs.push({ outcome: i.outcome, observedAt: i.observed_at, transport: seg?.transport_type, route: seg?.transport_number || undefined });
    }
  }
  if (!obs.length) {
    return emptyState({ text: 'Отмечайте контролёров на этапах поездки — и поездки без них тоже, иначе доли будут завышены.', compact: true });
  }
  const st = inspectionStats(obs);
  const p = st.checkRate;
  const hours = [...st.byHour].sort((x, y) => x[0] - y[0]);
  const hourChartPoints = Array.from({ length: 24 }, (_, h) => {
    const g = st.byHour.get(h);
    return { label: h % 6 === 0 ? `${h}:00` : '', title: `${h}:00–${h + 1}:00, наблюдений: ${g?.trials ?? 0}`, value: g?.successes ?? 0 };
  }).slice(5, 23);
  return html`
    ${metricGrid(
      metricCard('Встреч с контролёром', String(st.encounters), { hint: `из ${st.known} наблюдений` }),
      metricCard('Проверок билета', String(st.checks), { hint: p.trials ? `доля ${pct(p.estimate)}` : '' }),
    )}
    <div style="margin-top:var(--s-4)">
      <div class="row-between"><span class="t-sub">Проверяли билет</span><span class="pill ${p.reliability}">${RELIABILITY[p.reliability]}</span></div>
      ${ciBar(p)}
      <p class="t-caption">${pct(p.estimate)} ваших отмеченных поездок; 95 % интервал ${pct(p.interval.low)}–${pct(p.interval.high)} при n = ${p.trials}. Это описание прошлого, а не вероятность проверки завтра.</p>
    </div>
    ${hours.length > 1 ? html`<div style="margin-top:var(--s-5)">${chartContainer({
      id: 'insp-hours', title: 'Проверки по часам', total: '', points: hourChartPoints, format: (v) => `${v}`,
      selected: app.ui['chart:insp-hours'] ?? null, height: 110,
    })}</div>` : ''}
    <details style="margin-top:var(--s-4)"><summary class="t-callout accent">Подробнее по маршрутам и вариантам</summary>
      <table class="table"><tbody>
        ${Object.entries(st.counts).map(([k, n]) => html`<tr><td>${OUTCOME_LABELS[k]}</td><td>${n}</td></tr>`)}
        ${[...st.byRoute].filter(([k]) => k !== '—').sort((x, y) => y[1].trials - x[1].trials).slice(0, 6)
          .map(([k, q]) => html`<tr><td>№${k}</td><td>${pct(q.estimate)} · n = ${q.trials}</td></tr>`)}
      </tbody></table>
    </details>`;
}

function savingsSection(app) {
  const c = app.ui.calc ??= { aMin: 35, aCost: 3000, bMin: 50, bCost: 1800, trips: 44 };
  return html`
    <div class="grid-2">
      ${['a', 'b'].map((k) => html`<div class="surface" style="padding:var(--s-3)">
        <div class="t-sub" style="margin-bottom:var(--s-2)">Маршрут ${k === 'a' ? 'А' : 'Б'}</div>
        <label class="field" style="margin-bottom:var(--s-2)"><span>минут</span><input inputmode="numeric" data-field="${k}Min" value="${c[`${k}Min`]}"></label>
        <label class="field" style="margin:0"><span>стоимость, ₴</span><input inputmode="decimal" data-field="${k}Cost" value="${moneyToInput(c[`${k}Cost`])}"></label>
      </div>`)}
    </div>
    <label class="field" style="margin-top:var(--s-3)"><span>Поездок в месяц</span><input inputmode="numeric" data-field="trips" value="${c.trips}"></label>
    <div id="calc-result">${savingsResult(c)}</div>`;
}

function savingsResult(c) {
  const r = compareRoutes({ name: 'А', minutes: c.aMin, cost: c.aCost }, { name: 'Б', minutes: c.bMin, cost: c.bCost });
  if (r.verdict === 'identical') return html`<p class="t-callout">Маршруты равноценны.</p>`;
  if (r.verdict === 'dominates') return html`<p class="t-callout">Маршрут ${r.winner} и не дороже, и не медленнее — выбор очевиден.</p>`;
  const m = projectSavings(r, c.trips);
  return html`
    <p class="t-callout">Маршрут ${r.cheaper} экономит ${formatMoney(r.saved)}, но дольше на ${r.minutesLost} мин.</p>
    <p class="t-num-lg accent" style="margin:var(--s-2) 0">Минута стоит ${formatMoney(r.perMinute)}</p>
    <p class="t-caption">За месяц (${c.trips} поездок): ${formatMoney(m.money)} экономии и ${m.hours.toFixed(1).replace('.', ',')} ч в дороге дополнительно.</p>`;
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
    const points = series(all, period, now);
    const byDir = costByDirection(trips);
    const fMonth = forecast(all, 'month', now);
    const fYear = forecast(all, 'year', now);
    const avgDay = averageCommuteDayCost(trips);
    const avgTrip = averageTripMs(t);

    if (!all.length) {
      return html`${topBar('Аналитика', { large: true })}${emptyState({
        icon: ICONS.analytics, title: 'Пока нечего анализировать',
        text: 'После первых поездок здесь появятся расходы, время в дороге, сравнение маршрутов и статистика контролёров.',
        action: html`<button class="btn btn-primary btn-sm" data-action="quick-add">Добавить поездку</button>`,
      })}`;
    }

    return html`
      ${topBar('Аналитика', { large: true })}
      <div class="stack-lg">
        ${segmented(PERIODS, period, { action: 'period', label: 'Период' })}

        <section class="reveal" aria-label="Расходы">
          ${chartContainer({
            id: 'expenses', title: 'Расходы', total: formatMoney(t.cost),
            subtitle: avgDay != null ? `${formatMoney(avgDay)} в день` : '',
            points: points.map((p) => ({ label: p.label, title: p.title, value: p.cost })), format: formatMoney,
            selected: app.ui['chart:expenses'] ?? null,
          })}
          <div style="margin-top:var(--s-4)">${metricGrid(
            metricCard('На работу', formatMoney(byDir.to_work || 0)),
            metricCard('Домой', formatMoney(byDir.to_home || 0)),
          )}</div>
        </section>

        <section class="reveal" aria-label="Время в дороге">
          ${chartContainer({
            id: 'time', title: 'Время в дороге', total: formatHours(t.activeMs),
            subtitle: avgTrip != null ? `≈ ${formatDuration(avgTrip)} за поездку` : '',
            points: points.map((p) => ({ label: p.label, title: p.title, value: p.ms })),
            format: (v) => (v >= HOUR ? formatHours(v) : formatDuration(v)),
            selected: app.ui['chart:time'] ?? null,
          })}
        </section>

        <section class="reveal">${sectionTitle('Транспорт')}${transportSection(trips)}</section>
        <section class="reveal">${sectionTitle('Сравнение маршрутов')}${routesSection(app, trips)}</section>

        <section class="reveal">
          ${sectionTitle('Прогноз')}
          ${fMonth && fYear ? html`
            ${metricGrid(metricCard('До конца месяца', formatMoney(fMonth.projected)), metricCard('До конца года', formatMoney(fYear.projected)))}
            <p class="t-caption" style="margin-top:var(--s-3)">По ${fMonth.basedOnDays} дням поездок: ${formatMoney(fMonth.averagePerDay)} в день, поездки в ${pct(fMonth.rate)} будних дней.</p>`
            : emptyState({ text: 'Прогноз появится после 5 дней с поездками — иначе он был бы случайным.', compact: true })}
        </section>

        <section class="reveal">${sectionTitle('Контролёры')}${inspectionsSection(app, period, now)}</section>
        <section class="reveal">${sectionTitle('Калькулятор экономии')}${savingsSection(app)}</section>
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
    el.closest('main').querySelector('#calc-result').innerHTML = savingsResult(c).toString();
    return false;
  },
  actions: {
    period: (app, el) => {
      app.ui.period = el.dataset.value;
      app.ui['chart:expenses'] = app.ui['chart:time'] = null;
      app.haptic();
      app.rerender();
    },
  },
};
