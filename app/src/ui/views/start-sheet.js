// Выбор транспорта и цены — одна шторка на два случая:
//  • «Старт»: «На чём едете?» → поездка начинается с этого этапа;
//  • в пути: «На что пересели?» → текущий этап закрывается, начинается новый (можно «2 мин назад»).
// Крупно — автобус, маршрутка, пешком; остальное — по кнопке «Другой транспорт».
import { html } from '../html.js';
import { primaryButton, transportSelector } from '../components.js';
import { formatMoney, parseMoney, moneyToInput } from '../../core/money.js';
import { DIRECTIONS, TRANSPORT, TRANSPORT_ICONS, TICKETED, ICONS, formatTime } from '../format.js';
import { zonedParts, zonedTime, startOfDay, addDays } from '../../core/time.js';
import { sheetHeader } from '../sheet.js';
import { frequentCosts, routeNumbers } from '../suggest.js';
import { startTrip } from '../actions.js';

export const MAIN_TRANSPORT = ['bus', 'minibus', 'walk'];
const FREE = new Set(['walk', 'bicycle', 'scooter', 'car']);
const AGO = [0, 2, 5]; // минут назад

/** Чем начинали последнюю поездку в этом направлении — оттуда выбор по умолчанию. */
function lastFirstTransport(store, direction) {
  const trip = store.liveTrips().find((t) => t.status === 'completed' && t.direction === direction);
  return trip ? store.segmentsOf(trip.id)[0]?.transport_type ?? null : null;
}

const defaultCost = (store, transport) => (FREE.has(transport) ? 0 : frequentCosts(store, transport, 1)[0] ?? null);

function choose(app, transport) {
  const p = app.ui.pick;
  if (p.transport !== transport) p.number = '';
  p.transport = transport;
  p.cost = defaultCost(app.store, transport);
  if (!MAIN_TRANSPORT.includes(transport)) p.more = true;
}

/** «Старт» → «На чём едете?» */
export function openStartSheet(app, direction, { onStarted } = {}) {
  const transport = lastFirstTransport(app.store, direction) ?? 'minibus';
  app.ui.pick = { mode: 'start', direction, transport, number: '', cost: defaultCost(app.store, transport), more: !MAIN_TRANSPORT.includes(transport), ago: 0, onDone: onStarted };
  return app.openSheet(transportSheet);
}

/**
 * В пути → «На что пересели?». template — следующий этап шаблона (транспорт, номер, цена).
 */
export function openChangeSheet(app, { transport = null, template = null } = {}) {
  const t = template?.transport_type ?? transport ?? 'minibus';
  app.ui.pick = {
    mode: 'change', transport: t, number: template?.transport_number ?? '',
    cost: template?.cost ?? defaultCost(app.store, t), more: !MAIN_TRANSPORT.includes(t), ago: 0,
  };
  return app.openSheet(transportSheet);
}

/** Правка этапа (в пути): транспорт, цена, номер, время начала; удаление. */
export function openEditSheet(app, segmentId) {
  const seg = app.store.data.trip_segments.get(segmentId);
  if (!seg) return null;
  app.ui.pick = {
    mode: 'edit', segmentId, transport: seg.transport_type, number: seg.transport_number ?? '', cost: seg.cost,
    more: !MAIN_TRANSPORT.includes(seg.transport_type), time: toTimeInput(seg.started_at),
  };
  return app.openSheet(transportSheet);
}

const toTimeInput = (ms) => (ms == null ? '' : formatTime(ms).replace(/\s/g, ''));

/** «ЧЧ:ММ» → момент: из соседних дней берётся ближайший к прежнему началу этапа. */
function fromTimeInput(value, around) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const cands = [-1, 0, 1].map((d) => {
    const day = zonedParts(addDays(startOfDay(around), d));
    return zonedTime(day.year, day.month, day.day, +m[1], +m[2]);
  });
  return cands.reduce((a, b) => (Math.abs(b - around) < Math.abs(a - around) ? b : a));
}

/** Момент смены: не раньше начала текущего этапа (и поездки). */
function changeAt(app, ago) {
  const s = app.tracker.session;
  const current = app.store.segmentsOf(s.tripId).at(-1);
  const floor = Math.max(s.startedAt, current?.started_at ?? 0) + 1000;
  return Math.min(Date.now(), Math.max(floor, Date.now() - ago * 60_000));
}

export const transportSheet = {
  label: 'Транспорт',
  render(app) {
    const p = app.ui.pick;
    const change = p.mode === 'change';
    const edit = p.mode === 'edit';
    const free = FREE.has(p.transport);
    const costs = free ? [] : frequentCosts(app.store, p.transport);
    const numbers = TICKETED.has(p.transport) && !p.number
      ? routeNumbers(app.store, '', 6).filter((x) => x.transport_type === p.transport).slice(0, 4) : [];
    const current = change ? app.store.segmentsOf(app.tracker.session.tripId).at(-1) : null;
    return html`
      ${sheetHeader(edit ? 'Этап' : change ? 'На что пересели?' : 'На чём едете?')}
      <p class="t-callout muted" style="margin:-8px 0 var(--s-4)">${edit ? 'Исправьте транспорт, цену или время начала'
        : change
          ? (current ? `Сейчас: ${TRANSPORT[current.transport_type]}${current.transport_number ? ` №${current.transport_number}` : ''} — этот этап закончится` : 'Первый этап поездки')
          : DIRECTIONS[p.direction]}</p>
      <div class="start-modes" role="group" aria-label="Транспорт">
        ${MAIN_TRANSPORT.map((t) => html`
          <button class="start-mode tr-${t} ${p.transport === t ? 'on' : ''}" aria-pressed="${p.transport === t}" data-action="pick-mode" data-value="${t}">
            ${TRANSPORT_ICONS[t]}<span>${TRANSPORT[t]}</span></button>`)}
      </div>
      ${p.more
        ? html`<div style="margin-top:var(--s-3)">${transportSelector(p.transport, { action: 'pick-mode', only: Object.keys(TRANSPORT).filter((k) => !MAIN_TRANSPORT.includes(k)) })}</div>`
        : html`<button class="btn btn-ghost btn-sm" style="margin-top:var(--s-2)" data-action="pick-more">Другой транспорт</button>`}

      ${free
        ? html`<p class="t-callout muted" style="margin:var(--s-5) 0 0">${TRANSPORT[p.transport]} — без оплаты.</p>`
        : html`
          <label class="field" style="margin:var(--s-5) 0 var(--s-2)"><span>Цена</span>
            <span class="input-affix"><input class="numeric-input" data-field="pick.cost" inputmode="decimal" value="${p.cost ? moneyToInput(p.cost) : ''}" placeholder="0" autocomplete="off"><span class="affix">₴</span></span></label>
          ${costs.length ? html`<div class="chips">${costs.map((c) => html`
            <button class="chip ${c === p.cost ? 'on' : ''}" aria-pressed="${c === p.cost}" data-action="pick-cost" data-value="${c}">${formatMoney(c)}</button>`)}</div>` : ''}
          ${TICKETED.has(p.transport) ? html`
            <label class="field" style="margin:var(--s-4) 0 var(--s-2)"><span>Номер маршрута — необязательно</span>
              <input data-field="pick.number" value="${p.number}" placeholder="Например, 720" autocomplete="off" enterkeyhint="done"></label>
            ${numbers.length ? html`<div class="chips">${numbers.map((n) => html`<button class="chip" data-action="pick-number" data-value="${n.transport_number}">№${n.transport_number}</button>`)}</div>` : ''}` : ''}`}

      ${change ? html`
        <div class="field" style="margin:var(--s-5) 0 0"><span>Когда пересели</span>
          <div class="chips" style="margin-top:6px">${AGO.map((m) => html`
            <button class="chip ${p.ago === m ? 'on' : ''}" aria-pressed="${p.ago === m}" data-action="pick-ago" data-value="${m}">${m ? `${m} мин назад` : 'Сейчас'}</button>`)}</div></div>` : ''}

      ${edit ? html`
        <label class="field" style="margin:var(--s-5) 0 0"><span>Начало этапа</span>
          <input type="time" data-field="pick.time" value="${p.time}"></label>
        <p class="t-caption" style="margin-top:6px">Предыдущий этап закончится в это же время.</p>
        <div class="btn-row" style="margin-top:var(--s-6)">
          <button class="btn btn-danger" data-action="pick-delete">${ICONS.trash}Удалить</button>
          ${primaryButton('Сохранить', { action: 'pick-save', icon: ICONS.check })}
        </div>`
        : html`<div style="margin-top:var(--s-6)">${primaryButton(change ? 'Пересел' : 'Поехали', { action: 'pick-go', icon: change ? ICONS.repeat : ICONS.play })}</div>`}`;
  },
  onInput(app, el) {
    const p = app.ui.pick;
    if (el.dataset.field === 'pick.number') p.number = el.value;
    if (el.dataset.field === 'pick.time') p.time = el.value;
    if (el.dataset.field === 'pick.cost') {
      const v = el.value.trim() === '' ? 0 : parseMoney(el.value);
      el.classList.toggle('invalid', v == null);
      if (v != null) p.cost = v;
    }
    return false; // не перерисовывать, пока печатают
  },
  actions: {
    'pick-mode': (app, el) => { choose(app, el.dataset.value); app.haptic(); app.renderSheet(); },
    'pick-more': (app) => { app.ui.pick.more = true; app.renderSheet(); },
    'pick-cost': (app, el) => { app.ui.pick.cost = +el.dataset.value; app.haptic(); app.renderSheet(); },
    'pick-number': (app, el) => { app.ui.pick.number = el.dataset.value; app.renderSheet(); },
    'pick-ago': (app, el) => { app.ui.pick.ago = +el.dataset.value; app.haptic(); app.renderSheet(); },
    'pick-save': async (app) => {
      const p = app.ui.pick;
      const seg = app.store.data.trip_segments.get(p.segmentId);
      const input = document.querySelector('#sheet [data-field="pick.cost"]');
      if (input && input.value.trim() !== '' && parseMoney(input.value) == null) {
        app.haptic('warning');
        app.toast('Проверьте цену: например, 15 или 15,50');
        return;
      }
      const started = p.time ? fromTimeInput(p.time, seg.started_at ?? Date.now()) : null;
      if (p.time && started == null) { app.toast('Время — в формате ЧЧ:ММ'); return; }
      await app.store.updateLiveSegment(p.segmentId, {
        transport_type: p.transport,
        transport_number: TICKETED.has(p.transport) ? p.number : null,
        cost: FREE.has(p.transport) ? 0 : (p.cost ?? 0),
        ...(started != null && started !== seg.started_at && Math.abs(started - seg.started_at) >= 60_000 ? { started_at: started } : {}),
      });
      app.haptic('success');
      app.closeSheet();
      app.toast('Этап изменён');
    },
    'pick-delete': async (app) => {
      const p = app.ui.pick;
      const seg = app.store.data.trip_segments.get(p.segmentId);
      const ok = await app.confirm({
        title: 'Удалить этап?',
        text: `${TRANSPORT[seg.transport_type]}${seg.cost ? ` · ${formatMoney(seg.cost)}` : ''}. Его время отойдёт предыдущему этапу.`,
        confirm: 'Удалить', danger: true,
      });
      if (!ok) return;
      await app.store.deleteLiveSegment(p.segmentId);
      app.haptic('success');
      app.toast('Этап удалён');
    },
    'pick-go': async (app) => {
      const p = app.ui.pick;
      const input = document.querySelector('#sheet [data-field="pick.cost"]');
      if (input && input.value.trim() !== '' && parseMoney(input.value) == null) {
        app.haptic('warning');
        app.toast('Проверьте цену: например, 15 или 15,50');
        return;
      }
      const segment = {
        transport_type: p.transport,
        transport_number: TICKETED.has(p.transport) ? p.number.trim() || null : null,
        cost: FREE.has(p.transport) ? 0 : (p.cost ?? 0),
      };
      app.closeSheet();
      app.haptic('success');
      if (p.mode === 'start') {
        await startTrip(app, { direction: p.direction, segment });
      } else {
        const s = app.tracker.session;
        if (!s) return;
        await app.store.appendLiveSegment(s.tripId, segment, changeAt(app, p.ago));
        app.toast(`Пересел: ${TRANSPORT[segment.transport_type]}${segment.cost ? ` · ${formatMoney(segment.cost)}` : ''}`);
      }
      p.onDone?.();
    },
  },
};
