// Быстрое добавление поездки в нижней шторке.
// По умолчанию подставляется прошлая поездка в этом направлении (время, маршрут, стоимость),
// поэтому стандартная поездка добавляется в два касания: «Добавить» → «Сохранить».
import { html } from '../html.js';
import { primaryButton, secondaryButton, segmented, transportSelector } from '../components.js';
import { formatMoney, parseMoney, moneyToInput } from '../../core/money.js';
import { addDays, startOfDay, zonedParts, zonedTime, MINUTE, formatDuration } from '../../core/time.js';
import { issueMessage } from '../../core/editing.js';
import { DIRECTIONS, TRANSPORT, TRANSPORT_ICONS, ICONS } from '../format.js';
import { sheetHeader } from '../sheet.js';
import { frequentTripCosts, routeNumbers, lastTrip } from '../suggest.js';
import { suggestedDirection } from './dashboard.js';

const DURATIONS = [30, 45, 60, 90];
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (ms) => { const p = zonedParts(ms); return `${pad(p.hour)}:${pad(p.minute)}`; };

function fromTrip(store, trip) {
  return store.segmentsOf(trip.id).map((s) => ({ transport_type: s.transport_type, transport_number: s.transport_number || '', cost: s.cost }));
}

function initial(app, { repeat = false, direction } = {}) {
  const { store } = app;
  const dir = direction ?? (repeat ? lastTrip(store)?.direction : null) ?? app.ui.homeDirection ?? suggestedDirection();
  const prev = repeat ? lastTrip(store) : lastTrip(store, dir);
  const now = Date.now();
  if (prev) {
    const minutes = Math.max(5, Math.round((prev.finished_at - prev.started_at) / MINUTE));
    const segments = fromTrip(store, prev);
    const segSum = segments.reduce((a, s) => a + s.cost, 0);
    return {
      direction: prev.direction, day: 'today', start: hhmm(prev.started_at), minutes, routeId: prev.route_id,
      segments: segments.length ? segments : [{ transport_type: 'minibus', transport_number: '', cost: 0 }],
      extra: prev.extra_cost || (segments.length ? 0 : store.tripCost(prev) - segSum), query: '', source: 'Как в прошлый раз',
    };
  }
  return {
    direction: dir, day: 'today', start: hhmm(now - 45 * MINUTE), minutes: 45, routeId: null,
    segments: [{ transport_type: 'minibus', transport_number: '', cost: 0 }], extra: 0, query: '', source: null,
  };
}

const total = (q) => q.segments.reduce((a, s) => a + s.cost, 0) + q.extra;

function toDraft(app, q) {
  const now = Date.now();
  const base = q.day === 'today' ? now : addDays(startOfDay(now), -1);
  const p = zonedParts(base);
  const [h, m] = q.start.split(':').map(Number);
  const start = zonedTime(p.year, p.month, p.day, h, m);
  const d = app.store.emptyDraft();
  Object.assign(d, { direction: q.direction, started_at: start, finished_at: start + q.minutes * MINUTE, route_id: q.routeId, extra_cost: q.extra });
  d.segments = q.segments.map((s) => app.store.newSegmentDraft(s));
  return d;
}

function render(app) {
  const q = app.ui.qa;
  const { store } = app;
  const templates = store.live('routes');
  const query = q.query.trim().toLowerCase();
  const matches = query ? [
    ...templates.filter((r) => r.name.toLowerCase().includes(query)).map((r) => ({ kind: 'route', id: r.id, label: r.name, hint: formatMoney(r.segments.reduce((a, s) => a + s.cost, 0)) })),
    ...routeNumbers(store, query).map((n) => ({ kind: 'number', ...n, label: `${TRANSPORT[n.transport_type]} №${n.transport_number}`, hint: '' })),
  ].slice(0, 5) : [];
  const costs = [...new Set([...frequentTripCosts(store), ...templates.map((r) => r.segments.reduce((a, s) => a + s.cost, 0))])].filter(Boolean).slice(0, 4);
  const single = q.segments.length === 1;
  const issues = app.store.draftIssues(toDraft(app, q));
  const blocking = issues.find((i) => i.blocking);
  const sum = total(q);

  return html`
    ${sheetHeader('Новая поездка')}
    ${q.source ? html`<p class="t-caption" style="margin:-8px 0 var(--s-4)">${ICONS.repeat} ${q.source} — проверьте и сохраните</p>` : ''}
    <div class="stack">
      ${segmented(DIRECTIONS, q.direction, { action: 'qa-direction', label: 'Направление' })}

      <div class="grid-2">
        ${segmented({ today: 'Сегодня', yesterday: 'Вчера' }, q.day, { action: 'qa-day', label: 'День' })}
        <label class="field" style="margin:0"><span class="sr-only">Время начала</span>
          <input type="time" data-field="qa.start" value="${q.start}" aria-label="Время начала"></label>
      </div>
      <div>
        <span class="field-label">В пути: ${formatDuration(q.minutes * MINUTE)}</span>
        <div class="chips" style="margin-top:6px">
          ${DURATIONS.map((m) => html`<button class="chip ${m === q.minutes ? 'on' : ''}" aria-pressed="${m === q.minutes}" data-action="qa-minutes" data-value="${m}">${m} мин</button>`)}
          <input type="number" min="1" max="600" inputmode="numeric" data-field="qa.minutes" value="${DURATIONS.includes(q.minutes) ? '' : q.minutes}" placeholder="другое" aria-label="Минут в пути" style="width:96px;min-height:36px;padding:6px 10px">
        </div>
      </div>

      <label class="field" style="margin:0"><span>Маршрут</span>
        <input data-field="qa.query" value="${q.query}" placeholder="Шаблон или номер, например 720" autocomplete="off" enterkeyhint="search"></label>
      ${matches.length ? html`<div class="suggestions" role="listbox">${matches.map((m) => html`
        <button role="option" data-action="qa-pick" data-kind="${m.kind}" data-id="${m.id ?? ''}" data-transport="${m.transport_type ?? ''}" data-number="${m.transport_number ?? ''}">
          <span>${m.label}</span><span class="t-caption">${m.hint}</span></button>`)}</div>` : ''}

      ${single ? transportSelector(q.segments[0].transport_type, { action: 'qa-transport' }) : html`
        <div class="chips">${q.segments.map((s, i) => html`<span class="chip static">${TRANSPORT_ICONS[s.transport_type]}${TRANSPORT[s.transport_type]}${s.transport_number ? ` №${s.transport_number}` : ''} · ${formatMoney(s.cost)}
          <button class="btn-ghost" style="border:0;background:none;color:var(--text-tertiary);padding:0 0 0 4px;cursor:pointer" data-action="qa-remove" data-i="${i}" aria-label="Убрать этап">✕</button></span>`)}</div>`}

      <label class="field" style="margin:0"><span>Стоимость поездки</span>
        <span class="input-affix"><input class="numeric-input" data-field="qa.total" inputmode="decimal" value="${moneyToInput(sum)}" placeholder="0"><span class="affix">₴</span></span></label>
      ${costs.length ? html`<div class="chips">${costs.map((c) => html`<button class="chip ${c === sum ? 'on' : ''}" data-action="qa-cost" data-value="${c}">${formatMoney(c)}</button>`)}</div>` : ''}

      ${issues.length ? html`<p class="t-caption ${blocking ? 'error' : 'warn'}" id="qa-issues">${issueMessage(blocking ?? issues[0])}</p>` : html`<p id="qa-issues" hidden></p>`}
      <button class="btn btn-ghost btn-sm" data-action="qa-stages">${ICONS.route}С пересадками — по этапам и времени</button>
      <div class="btn-row">
        ${secondaryButton('Подробнее', { action: 'qa-more' })}
        ${primaryButton('Сохранить', { action: 'qa-save', disabled: blocking ? true : null })}
      </div>
    </div>`;
}

function setTotal(q, value) {
  if (q.segments.length === 1) {
    q.segments[0].cost = value;
    q.extra = 0;
  } else {
    const seg = q.segments.reduce((a, s) => a + s.cost, 0);
    if (value >= seg) q.extra = value - seg;
    else { q.segments.forEach((s) => { s.cost = 0; }); q.extra = value; }
  }
}

export function openQuickAdd(app, opts = {}) {
  app.ui.qa = initial(app, opts);
  app.openSheet({
    label: 'Новая поездка',
    render,
    onInput: (a, el, type) => {
      const q = a.ui.qa;
      const f = el.dataset.field;
      if (f === 'qa.start') { if (el.value) q.start = el.value; return true; }
      if (f === 'qa.minutes') {
        const m = Number(el.value);
        if (m > 0 && m <= 600) q.minutes = Math.round(m);
        return type === 'change'; // пересчитать подпись после завершения ввода
      }
      if (f === 'qa.query') { q.query = el.value; return ev(el); }
      if (f === 'qa.total') {
        const v = parseMoney(el.value || '0');
        el.classList.toggle('invalid', v == null);
        if (v != null) setTotal(q, v);
      }
      return false;
    },
    actions: {
      'qa-direction': (a, el) => {
        const keep = a.ui.qa.query;
        a.ui.qa = { ...initial(a, { direction: el.dataset.value }), query: keep };
        a.haptic();
        a.renderSheet();
      },
      'qa-day': (a, el) => { a.ui.qa.day = el.dataset.value; a.haptic(); a.renderSheet(); },
      'qa-minutes': (a, el) => { a.ui.qa.minutes = +el.dataset.value; a.haptic(); a.renderSheet(); },
      'qa-transport': (a, el) => { a.ui.qa.segments[0].transport_type = el.dataset.value; a.haptic(); a.renderSheet(); },
      'qa-cost': (a, el) => { setTotal(a.ui.qa, +el.dataset.value); a.haptic(); a.renderSheet(); },
      'qa-remove': (a, el) => {
        const q = a.ui.qa;
        q.segments.splice(+el.dataset.i, 1);
        if (!q.segments.length) q.segments.push({ transport_type: 'minibus', transport_number: '', cost: 0 });
        q.routeId = null;
        a.renderSheet();
      },
      'qa-pick': (a, el) => {
        const q = a.ui.qa;
        if (el.dataset.kind === 'route') {
          const r = a.store.data.routes.get(el.dataset.id);
          q.routeId = r.id;
          q.direction = r.direction;
          q.segments = r.segments.map((s) => ({ transport_type: s.transport_type, transport_number: s.transport_number || '', cost: s.cost }));
          q.extra = 0;
        } else {
          q.routeId = null;
          q.segments = [{ transport_type: el.dataset.transport, transport_number: el.dataset.number, cost: q.segments.length === 1 ? q.segments[0].cost : total(q) }];
          q.extra = 0;
        }
        q.query = '';
        q.source = null;
        a.haptic();
        a.renderSheet();
      },
      'qa-save': async (a) => {
        await a.store.saveTrip(toDraft(a, a.ui.qa));
        a.haptic('success');
        a.closeSheet();
        a.toast('Поездка добавлена');
      },
      'qa-stages': (a) => { a.closeSheet(); a.navigate('#/past'); },
      'qa-more': (a) => {
        a.ui.pendingDraft = toDraft(a, a.ui.qa);
        a.closeSheet();
        a.navigate('#/new');
      },
    },
  });
}

/** Подсказки маршрута перерисовываются после ввода, не теряя фокус (без полной перерисовки поля). */
function ev(el) {
  const sheet = el.closest('.sheet-body');
  queueMicrotask(() => {
    const pos = el.selectionStart;
    const value = el.value;
    // Перерисовка шторки заменит поле — восстановим фокус и курсор
    setTimeout(() => {
      const input = sheet.querySelector('[data-field="qa.query"]');
      if (input && document.activeElement !== input) {
        input.focus({ preventScroll: true });
        input.value = value;
        input.setSelectionRange(pos, pos);
      }
    }, 0);
  });
  return true;
}
