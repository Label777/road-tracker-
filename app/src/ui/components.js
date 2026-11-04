// Компоненты дизайн-системы. Каждый — чистая функция «данные → разметка»,
// действия пробрасываются через data-action и обрабатываются экраном.
import { html, raw } from './html.js';
import { formatMoney } from '../core/money.js';
import { formatDuration } from '../core/time.js';
import {
  DIRECTIONS, STATUS, TRANSPORT, ICONS, TRANSPORT_ICONS, formatDateTime, formatTime,
} from './format.js';

const attrs = (o = {}) => raw(Object.entries(o).filter(([, v]) => v != null && v !== false)
  .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`)).join(''));

// ------------------------------------------------------------------ кнопки

/** PrimaryButton */
export const primaryButton = (label, { action, icon = '', size = '', type = 'button', ...rest } = {}) => html`
  <button class="btn btn-primary ${size ? `btn-${size}` : ''}" type="${type}"${attrs({ 'data-action': action, ...rest })}>${icon}${label}</button>`;

/** SecondaryButton */
export const secondaryButton = (label, { action, icon = '', size = '', type = 'button', ...rest } = {}) => html`
  <button class="btn btn-secondary ${size ? `btn-${size}` : ''}" type="${type}"${attrs({ 'data-action': action, ...rest })}>${icon}${label}</button>`;

export const iconButton = (icon, label, { action, href, count } = {}) => (href
  ? html`<a class="icon-btn" href="${href}" aria-label="${label}">${icon}</a>`
  : html`<button class="icon-btn" type="button" aria-label="${label}"${attrs({ 'data-action': action, 'data-count': count ?? null })}>${icon}</button>`);

export const segmented = (options, value, { action, field, label = '' } = {}) => html`
  <div class="segmented" role="group" aria-label="${label}">
    ${Object.entries(options).map(([k, v]) => html`<button type="button" aria-pressed="${k === value}"${attrs({ 'data-action': action, 'data-field': field, 'data-value': k })}>${v}</button>`)}
  </div>`;

/** TransportSelector: горизонтальная лента иконок. */
export const transportSelector = (value, { action = 'pick-transport', only = null } = {}) => html`
  <div class="transport-selector" role="group" aria-label="Вид транспорта">
    ${Object.entries(TRANSPORT).filter(([k]) => !only || only.includes(k)).map(([k, v]) => html`
      <button type="button" class="transport-option" aria-pressed="${k === value}" data-action="${action}" data-value="${k}">
        ${TRANSPORT_ICONS[k]}<span>${v}</span>
      </button>`)}
  </div>`;

// ------------------------------------------------------------------ данные

/** MetricCard: ячейка сетки метрик. */
export const metricCard = (label, value, { hint = '', icon = '' } = {}) => html`
  <div class="metric-card">
    <div class="label">${icon}${label}</div>
    <div class="value">${value}</div>
    ${hint ? html`<div class="hint">${hint}</div>` : ''}
  </div>`;

export const metricGrid = (...cards) => html`<div class="metric-grid">${cards}</div>`;

export const routeLine = (segments) => html`<span class="route-line">${segments.map((s, i) => html`
  ${i ? html`<span class="dash"></span>` : ''}${TRANSPORT_ICONS[s.transport_type]}<span>${s.transport_number || ''}</span>`)}</span>`;

/** TripCard */
export function tripCard(store, trip, { featured = false } = {}) {
  const segments = store.segmentsOf(trip.id);
  const ongoing = trip.status === 'active' || trip.status === 'paused';
  const href = ongoing ? '#/trip' : `#/edit/${trip.id}`;
  const status = trip.status === 'completed' ? formatDuration(store.tripActiveMs(trip)) : STATUS[trip.status];
  const timeRange = trip.finished_at ? `${formatTime(trip.started_at)}–${formatTime(trip.finished_at)}` : formatTime(trip.started_at);
  return html`
    <a class="trip-card ${featured ? 'featured' : ''}" href="${href}">
      <span class="glyph ${trip.direction === 'to_work' ? 'work' : ''}">${trip.direction === 'to_home' ? ICONS.home : trip.direction === 'to_work' ? ICONS.work : ICONS.pin}</span>
      <span class="main">
        <span class="title">${DIRECTIONS[trip.direction]}</span>
        <span class="sub">${featured ? formatDateTime(trip.started_at) : timeRange}${segments.length ? html` · ${routeLine(segments)}` : ''}</span>
      </span>
      <span class="end">
        <span class="t-num">${formatMoney(store.tripCost(trip))}</span>
        <span class="t-caption ${trip.status === 'suggested' ? 'warn' : ''}">${status}</span>
      </span>
    </a>`;
}

/** ExpenseCard: строка расхода с долей. */
export const expenseCard = ({ icon, label, value, share = null, hint = '' }) => html`
  <div class="expense-card">
    <span class="glyph">${icon}</span>
    <span>
      <span class="t-sub">${label}</span>${hint ? html` <span class="t-caption">${hint}</span>` : ''}
      ${share != null ? html`<span class="bar"><i style="width:${Math.max(2, Math.round(share * 100))}%"></i></span>` : ''}
    </span>
    <span class="t-num">${value}</span>
  </div>`;

/** TrackingStatus: состояние GPS/записи. kind: on | warn | off | idle */
export const trackingStatus = (kind, text) => html`<span class="tracking-status ${kind}" role="status"><i></i>${text}</span>`;

/**
 * ChartContainer: столбчатая диаграмма с подписями осей, сеткой, анимацией роста
 * и подсказкой по нажатию. points: [{label, value, title}]
 */
export function chartContainer({ id, title, total = '', subtitle = '', points, format = String, selected = null, height = 160 }) {
  const max = Math.max(...points.map((p) => p.value), 0);
  const nice = niceMax(max);
  const step = Math.ceil(points.length / 7);
  const sel = selected != null ? points[selected] : null;
  if (!points.length || max === 0) {
    return html`<div class="chart-container">
      <div class="chart-head"><div><div class="t-caption">${title}</div><span class="t-num-lg">${total}</span></div></div>
      ${emptyState({ icon: ICONS.analytics, text: 'Нет данных за период', compact: true })}</div>`;
  }
  return html`
    <div class="chart-container" id="${id}">
      <div class="chart-head">
        <div><div class="t-caption">${title}</div><span class="t-num-lg">${total}</span></div>
        ${subtitle ? html`<span class="t-caption">${subtitle}</span>` : ''}
      </div>
      <div class="chart ${sel ? 'dim' : ''}" style="height:${height}px" role="list">
        ${[0.5, 1].map((f) => html`<div class="gridline" style="bottom:${20 + f * (height - 28)}px"><span>${format(nice * f)}</span></div>`)}
        ${points.map((p, i) => html`
          <button type="button" role="listitem" class="col ${p.value ? '' : 'zero'}" aria-pressed="${i === selected}"
            data-action="chart-tip" data-chart="${id}" data-i="${i}" aria-label="${p.title}: ${format(p.value)}">
            <i style="height:${p.value ? Math.max(3, (p.value / nice) * (height - 28)) : 3}px;animation-delay:${Math.min(i * 12, 300)}ms"></i>
            ${i % step === 0 ? html`<span class="x">${p.label}</span>` : ''}
          </button>`)}
        ${sel ? html`<div class="chart-tip" style="left:${Math.min(84, Math.max(16, ((selected + 0.5) / points.length) * 100))}%"><b>${format(sel.value)}</b><small>${sel.title}</small></div>` : ''}
      </div>
    </div>`;
}

function niceMax(v) {
  if (v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
}

/** EmptyState */
export const emptyState = ({ icon = ICONS.trip, title = '', text = '', action = '', compact = false }) => html`
  <div class="empty-state ${compact ? 'compact' : ''}">
    ${compact ? '' : html`<span class="art">${icon}</span>`}
    ${title ? html`<strong class="t-sub">${title}</strong>` : ''}
    ${text ? html`<p class="t-callout">${text}</p>` : ''}
    ${action}
  </div>`;

export const notice = (n, actions = '') => (n ? html`
  <div class="notice ${n.kind === 'suggest' ? '' : n.kind}" role="status">
    <div class="body"><div class="t-callout">${n.text}</div>
      <div class="actions">${actions}<button class="btn btn-ghost btn-sm" data-action="dismiss-notice">Скрыть</button></div>
    </div>
  </div>` : '');

export const topBar = (title, { back = null, actions = '', large = false } = {}) => html`
  <header class="topbar ${large ? 'large' : ''}">
    ${back ? iconButton(ICONS.back, 'Назад', { href: back }) : ''}
    <h1>${title}</h1>
    <div class="topbar-actions">${actions}</div>
  </header>`;

export const sectionTitle = (title, link = '') => html`<div class="section-title"><h2>${title}</h2>${link}</div>`;

export const group = (title, cells, footer = '') => html`
  <section>
    ${title ? html`<h2 class="group-title">${title}</h2>` : ''}
    <div class="group">${cells}</div>
    ${footer ? html`<p class="group-footer">${footer}</p>` : ''}
  </section>`;

/** Ячейка настроек: ссылка, кнопка или переключатель. */
export function cell({ icon = '', title, sub = '', value = '', href, action, toggle, field, danger = false, data = {} }) {
  const inner = html`
    ${icon ? html`<span class="icon">${icon}</span>` : ''}
    <span class="main"><span>${title}</span>${sub ? html`<small>${sub}</small>` : ''}</span>
    ${value ? html`<span class="value">${value}</span>` : ''}`;
  if (toggle != null) {
    return html`<label class="cell switch-row">${inner}<input type="checkbox" class="switch" data-field="${field}" ${toggle ? 'checked' : ''}></label>`;
  }
  if (href) return html`<a class="cell ${danger ? 'danger' : ''}" href="${href}">${inner}<span class="chev">${ICONS.chevron}</span></a>`;
  return html`<button type="button" class="cell ${danger ? 'danger' : ''}"${attrs({ 'data-action': action, ...data })}>${inner}</button>`;
}

export const empty = (text) => emptyState({ text, compact: true });
