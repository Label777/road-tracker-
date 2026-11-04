import { html, raw } from './html.js';
import { formatMoney } from '../core/money.js';
import { formatDuration } from '../core/time.js';
import { DIRECTIONS, STATUS, ICONS, formatDateTime, formatDate } from './format.js';

export const card = (title, body, extra = '') => html`
  <section class="card">
    ${title ? html`<header class="card-title"><span>${title}</span>${extra}</header>` : ''}
    ${body}
  </section>`;

export const metric = (value, label) => html`<div class="metric"><div class="metric-value">${value}</div><div class="metric-label">${label}</div></div>`;

export const metrics = (...items) => html`<div class="metrics">${items}</div>`;

export const topBar = (title, { back = null, actions = '' } = {}) => html`
  <header class="topbar">
    ${back ? html`<a class="icon-btn" href="${back}" aria-label="Назад">${ICONS.back}</a>` : html`<span></span>`}
    <h1>${title}</h1>
    <div class="topbar-actions">${actions}</div>
  </header>`;

export function tripRow(store, trip) {
  const cost = store.tripCost(trip);
  const segs = store.segmentsOf(trip.id);
  const route = segs.map((s) => (s.transport_number ? s.transport_number : '')).filter(Boolean).join(' → ');
  const suggested = trip.status === 'suggested';
  const ongoing = trip.status === 'active' || trip.status === 'paused';
  return html`
    <a class="row" href="${ongoing ? '#/trip' : `#/edit/${trip.id}`}">
      <span class="row-icon">${trip.direction === 'to_home' ? ICONS.home : ICONS.trip}</span>
      <span class="row-main">
        <span class="row-title">${DIRECTIONS[trip.direction]}${route ? html` <span class="muted">· ${route}</span>` : ''}</span>
        <span class="row-sub">${formatDateTime(trip.started_at)}</span>
      </span>
      <span class="row-end">
        <span class="mono">${formatMoney(cost)}</span>
        <span class="row-sub ${suggested ? 'warn' : ''}">${trip.status === 'completed' ? formatDuration(store.tripActiveMs(trip)) : STATUS[trip.status]}</span>
      </span>
    </a>`;
}

/** Столбчатая диаграмма (SVG). points: [{label, value, title}] */
export function barChart(points, { height = 140, format = (v) => v } = {}) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const w = 100 / points.length;
  const bars = points.map((p, i) => {
    const h = (p.value / max) * (height - 22);
    return `<g><title>${p.title}: ${format(p.value)}</title>
      <rect x="${(i * w + w * 0.15).toFixed(2)}%" y="${height - 18 - h}" width="${(w * 0.7).toFixed(2)}%" height="${Math.max(h, p.value > 0 ? 2 : 0)}" rx="2" class="bar"/></g>`;
  }).join('');
  const step = Math.ceil(points.length / 8);
  const labels = points.map((p, i) => (i % step === 0
    ? `<text x="${(i * w + w / 2).toFixed(2)}%" y="${height - 4}" text-anchor="middle" class="axis">${p.label}</text>` : '')).join('');
  return raw(`<svg class="chart" width="100%" height="${height}" role="img" aria-label="Диаграмма">${bars}${labels}</svg>`);
}

export const notice = (n, actions = '') => (n ? html`
  <div class="notice notice-${n.kind}" role="status">
    <span>${n.text}</span>
    <span class="notice-actions">${actions}<button class="link" data-action="dismiss-notice">Скрыть</button></span>
  </div>` : '');

export const dayLabel = (ms) => formatDate(ms);

export const empty = (text) => html`<p class="empty">${text}</p>`;
