// Аналитика: расходы и время в дороге (интерактивные графики), транспорт, сравнение
// реальных маршрутов, контролёры, прогноз, калькулятор «деньги против времени».
import { html } from '../html.js';
import { topBar, segmented, chartContainer, expenseCard, emptyState, metricCard, metricGrid, sectionTitle } from '../components.js';
import { formatMoney, parseMoney, moneyToInput } from '../../core/money.js';
import { formatDuration, formatHours, periodInterval, zonedParts, HOUR } from '../../core/time.js';
import {
  totalsOf, inInterval, costByDirection, costByTransport, dailySeries, averageCommuteDayCost, forecast,
  compareRoutes, projectSavings, averageTripMs, routeStats, segmentSignature, movementTotals,
} from '../../core/analytics.js';
import { inspectionStats } from '../../core/inspections.js';
import { insights } from '../../core/insights.js';
import { staleNotice } from '../stale.js';
import { TRANSPORT, TRANSPORT_ICONS, OUTCOME_LABELS, RELIABILITY, ICONS, formatPercent, LOCALE, formatDistance, plural } from '../format.js';

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
      ${items.map(([k, v], i) => html`<i class="tr-${k}" style="width:${(v / sum) * 100}%;background:var(--tr);animation-delay:${i * 60}ms" title="${TRANSPORT[k]}"></i>`)}
    </div>
    ${items.map(([k, v]) => html`<div class="tr-${k} tr-bar">${expenseCard({
      icon: TRANSPORT_ICONS[k],
      label: TRANSPORT[k], value: formatMoney(v), hint: pct(v / sum), share: v / sum,
    })}</div>`)}`;
}

function routeLabeler(store) {
  return (t) => {
    if (t.routeId) {
      const r = store.data.routes.get(t.routeId);
      if (r) return { key: `r:${r.id}`, label: r.name };
    }
    const sig = segmentSignature(t);
    const text = t.segments.filter((s) => s.transport !== 'walk')
      .map((s) => (s.number ? `${TRANSPORT[s.transport]} ${s.number}` : TRANSPORT[s.transport])).join(' → ') || 'Без этапов';
    return { key: `s:${t.direction}:${sig}`, label: text };
  };
}

function routesSection(app, trips) {
  const stats = routeStats(trips, routeLabeler(app.store)).filter((r) => r.count >= 2).slice(0, 4);
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

/**
 * Калькулятор «деньги против времени». Подставляет два ваших самых частых маршрута
 * (средние по истории) и число поездок за последние 30 дней; без истории поля пустые.
 */
function calcDefaults(app, all, now) {
  const stats = routeStats(all, routeLabeler(app.store)).filter((r) => r.count >= 2);
  const recent = all.filter((t) => t.startedAt >= now - 30 * 86_400_000).length;
  const [a, b] = stats;
  const pick = (r) => (r ? { min: Math.round(r.avgMs / 60_000), cost: r.avgCost, label: r.label, count: r.count } : { min: null, cost: null, label: '', count: 0 });
  const A = pick(a);
  const B = pick(b);
  return { aMin: A.min, aCost: A.cost, aLabel: A.label, aCount: A.count, bMin: B.min, bCost: B.cost, bLabel: B.label, bCount: B.count, trips: recent || null };
}

function savingsSection(app, all, now) {
  const c = app.ui.calc ??= calcDefaults(app, all, now);
  const field = (k, kind) => {
    const v = c[`${k}${kind}`];
    const value = v == null ? '' : kind === 'Cost' ? moneyToInput(v) : v;
    return html`<input inputmode="${kind === 'Cost' ? 'decimal' : 'numeric'}" data-field="${k}${kind}" value="${value}" placeholder="${kind === 'Cost' ? 'цена' : 'мин'}">`;
  };
  return html`
    ${c.aLabel ? html`<p class="t-caption" style="margin-bottom:var(--s-3)">Подставлены средние по вашим поездкам — поменяйте значения, чтобы сравнить другой вариант.</p>` : ''}
    <div class="grid-2">
      ${['a', 'b'].map((k) => html`<div class="surface" style="padding:var(--s-3)">
        <div class="t-sub" style="margin-bottom:2px">Вариант ${k === 'a' ? 'А' : 'Б'}</div>
        <div class="t-caption" style="min-height:2.6em;margin-bottom:var(--s-2)">${c[`${k}Label`] ? `${c[`${k}Label`]} · поездок: ${c[`${k}Count`]}` : 'введите свои значения'}</div>
        <label class="field" style="margin-bottom:var(--s-2)"><span>минут в пути</span>${field(k, 'Min')}</label>
        <label class="field" style="margin:0"><span>стоимость, ₴</span>${field(k, 'Cost')}</label>
      </div>`)}
    </div>
    <label class="field" style="margin-top:var(--s-3)"><span>Поездок в месяц${c.trips && c.aLabel ? ' (за последние 30 дней)' : ''}</span><input inputmode="numeric" data-field="trips" value="${c.trips ?? ''}" placeholder="например, 40"></label>
    <div id="calc-result">${savingsResult(c)}</div>`;
}

function savingsResult(c) {
  if ([c.aMin, c.aCost, c.bMin, c.bCost].some((v) => v == null)) {
    return html`<p class="t-callout muted">Введите время и цену двух вариантов дороги — калькулятор покажет, сколько стоит каждая сэкономленная минута.</p>`;
  }
  const r = compareRoutes({ name: 'А', minutes: c.aMin, cost: c.aCost }, { name: 'Б', minutes: c.bMin, cost: c.bCost });
  if (r.verdict === 'identical') return html`<p class="t-callout">Варианты равноценны.</p>`;
  if (r.verdict === 'dominates') return html`<p class="t-callout">Вариант ${r.winner} и не дороже, и не медленнее — выбор очевиден.</p>`;
  const m = c.trips ? projectSavings(r, c.trips) : null;
  return html`
    <p class="t-callout">Вариант ${r.cheaper} экономит ${formatMoney(r.saved)} за поездку, но дольше на ${r.minutesLost} мин.</p>
    <p class="t-num-lg accent" style="margin:var(--s-2) 0">Минута стоит ${formatMoney(r.perMinute)}</p>
    ${m ? html`<p class="t-caption">За месяц (${c.trips} поездок): ${formatMoney(m.money)} экономии и ${m.hours.toFixed(1).replace('.', ',')} ч в дороге дополнительно.</p>` : ''}`;
}

const PERIOD_IN = { week: 'за неделю', month: 'за месяц', year: 'за год' };

/** Пешком и расстояние: шаги, метры, среднее в день с ходьбой. */
function movementSection(trips, period) {
  const m = movementTotals(trips);
  if (!m.walkTrips && !m.gpsTrips) return '';
  const approx = m.estimated ? '≈' : '';
  return html`<section class="reveal">${sectionTitle('Пешком и расстояние')}
    ${metricGrid(
      metricCard(`Шаги ${PERIOD_IN[period]}`, m.steps ? `${approx}${m.steps.toLocaleString('ru-RU')}` : '—', {
        icon: TRANSPORT_ICONS.walk,
        hint: m.walkDays ? `в среднем ${approx}${Math.round(m.steps / m.walkDays).toLocaleString('ru-RU')} в день с ходьбой` : 'нет пеших этапов',
      }),
      metricCard(`Пешком ${PERIOD_IN[period]}`, m.walkMeters ? formatDistance(m.walkMeters) : '—', {
        hint: m.walkMeters ? `${m.walkTrips} ${plural(m.walkTrips, 'поездка', 'поездки', 'поездок')} с ходьбой` : 'расстояние — с GPS',
      }),
      metricCard(`Всего в пути ${PERIOD_IN[period]}`, m.gpsMeters ? formatDistance(m.gpsMeters) : '—', {
        hint: m.gpsTrips ? `по GPS, ${m.gpsTrips} ${plural(m.gpsTrips, 'поездка', 'поездки', 'поездок')}` : 'включите GPS в поездке',
      }),
    )}
    ${m.estimated ? html`<p class="t-caption" style="margin-top:var(--s-2)">«≈» — часть шагов оценена по расстоянию GPS или времени ходьбы. Точнее — с датчиком (Профиль → Шаги).</p>` : ''}
  </section>`;
}

function insightsSection(all, period, now) {
  const items = insights(all, period, now);
  if (!items.length) return '';
  return html`<section class="insights reveal" aria-label="Выводы">${items.map((x) => html`
    <p class="insight ${x.tone}"><i aria-hidden="true"></i><span>${x.text}</span></p>`)}</section>`;
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
      const live = !!app.tracker.session;
      return html`${topBar('Аналитика', { large: true })}${live ? html`<div class="stack" style="margin-bottom:var(--s-4)">${staleNotice(app, now)}</div>` : ''}${emptyState({
        icon: ICONS.analytics, title: live ? 'Поездка ещё записывается' : 'Пока нечего анализировать',
        text: live
          ? 'Завершённых поездок пока нет. Текущая запись появится здесь, как только вы нажмёте «Завершить» на экране поездки.'
          : 'После первых поездок здесь появятся расходы, время в дороге, сравнение маршрутов и статистика контролёров.',
        action: live
          ? html`<a class="btn btn-primary btn-sm" href="#/trip">Открыть поездку</a>`
          : html`<a class="btn btn-primary btn-sm" href="#/past">${ICONS.plus}Добавить прошлую поездку</a>`,
      })}`;
    }

    return html`
      ${topBar('Аналитика', { large: true, actions: html`<a class="icon-btn" href="#/past" aria-label="Добавить прошлую поездку">${ICONS.plus}</a>` })}
      <div class="stack-lg">
        ${app.tracker.session ? html`${staleNotice(app, now)}<a class="notice" href="#/trip" style="text-decoration:none;color:inherit"><div class="body t-callout">Идёт запись поездки — в аналитику она попадёт после «Завершить». Открыть →</div></a>` : ''}
        <a class="btn btn-secondary" href="#/past">${ICONS.plus}Добавить прошлую поездку</a>
        ${segmented(PERIODS, period, { action: 'period', label: 'Период' })}
        ${insightsSection(all, period, now)}

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
        ${movementSection(trips, period)}
        <section class="reveal">${sectionTitle('Сравнение маршрутов')}${routesSection(app, trips)}</section>

        <section class="reveal">
          ${sectionTitle('Прогноз')}
          ${fMonth && fYear ? html`
            ${metricGrid(metricCard('До конца месяца', formatMoney(fMonth.projected)), metricCard('До конца года', formatMoney(fYear.projected)))}
            <p class="t-caption" style="margin-top:var(--s-3)">По ${fMonth.basedOnDays} дням поездок: ${formatMoney(fMonth.averagePerDay)} в день, поездки в ${pct(fMonth.rate)} будних дней.</p>`
            : emptyState({ text: 'Прогноз появится после 5 дней с поездками — иначе он был бы случайным.', compact: true })}
        </section>

        <section class="reveal">${sectionTitle('Контролёры')}${inspectionsSection(app, period, now)}</section>
        <section class="reveal">${sectionTitle('Деньги против времени')}${savingsSection(app, all, now)}</section>
      </div>`;
  },
  onInput(app, el) {
    const c = app.ui.calc;
    const key = el.dataset.field;
    if (el.value.trim() === '') {
      el.classList.remove('invalid');
      c[key] = null;
      el.closest('main').querySelector('#calc-result').innerHTML = savingsResult(c).toString();
      return false;
    }
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
