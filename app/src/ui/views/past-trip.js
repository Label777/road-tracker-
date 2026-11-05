// «Прошлая поездка» — поездка задним числом целиком, по этапам: транспорт, номер, цена и минуты
// каждого этапа. Время этапов считается само (встык от выезда) и видно сразу.
import { html } from '../html.js';
import { topBar, segmented, primaryButton, secondaryButton } from '../components.js';
import { formatMoney, parseMoney, moneyToInput } from '../../core/money.js';
import { formatDuration, zonedParts, addDays, startOfDay, MINUTE } from '../../core/time.js';
import { buildPastTrip, stagesFrom, parseDateInput, parseTimeInput, dateInput, timeInput } from '../../core/past.js';
import { DIRECTIONS, TRANSPORT, TRANSPORT_ICONS, TICKETED, ICONS, formatTime, formatDateTime, plural } from '../format.js';
import { suggestedDirection } from '../actions.js';

const FREE = new Set(['walk', 'bicycle', 'scooter', 'car']);
const MINUTE_CHIPS = [5, 10, 15, 20, 30, 45];
const ORDER = ['walk', 'bus', 'minibus', 'metro', 'tram', 'trolleybus', 'train', 'taxi', 'car', 'bicycle', 'scooter', 'other'];

/** Последняя завершённая поездка в направлении — образец этапов и времени выезда. */
function lastTrip(store, direction) {
  return store.liveTrips().find((t) => t.status === 'completed' && t.direction === direction) ?? null;
}

function sample(store, direction) {
  const t = lastTrip(store, direction);
  if (!t) return { start: direction === 'to_home' ? 18 * 60 : 8 * 60, stages: [{ transport_type: 'minibus', transport_number: '', cost: 0, minutes: 30 }], from: null };
  const p = zonedParts(t.started_at);
  return { start: p.hour * 60 + p.minute, stages: stagesFrom(t, store.segmentsOf(t.id)), from: t.started_at };
}

function freshState(app, { direction, day } = {}) {
  const dir = direction ?? suggestedDirection();
  const s = sample(app.store, dir);
  return { direction: dir, date: dateInput(day ?? Date.now()), start: timeInput(s.start), stages: s.stages, comment: '', basedOn: s.from };
}

/** Время каждого этапа и итог — из текущего состояния (без ошибок, если что-то не заполнено). */
function computed(st) {
  const date = parseDateInput(st.date);
  const start = parseTimeInput(st.start);
  if (!date || start == null) return null;
  let t = start;
  const times = st.stages.map((s) => {
    const from = t;
    t += Number.isInteger(s.minutes) && s.minutes > 0 ? s.minutes : 0;
    return [from, t];
  });
  const clock = (m) => timeInput(((m % 1440) + 1440) % 1440);
  return {
    times: times.map(([a, b]) => `${clock(a)}–${clock(b)}`),
    total: (t - start) * MINUTE,
    end: clock(t),
    cost: st.stages.reduce((a, s) => a + (FREE.has(s.transport_type) ? 0 : s.cost || 0), 0),
    transfers: Math.max(0, st.stages.filter((s) => s.transport_type !== 'walk').length - 1),
  };
}

const summaryText = (c, st) => (c
  ? `${st.start} → ${c.end} · ${formatDuration(c.total)} · ${c.transfers ? `${c.transfers} ${plural(c.transfers, 'пересадка', 'пересадки', 'пересадок')} · ` : ''}${formatMoney(c.cost)}`
  : 'Укажите дату и время выезда');

function stageCard(st, s, i, times) {
  const free = FREE.has(s.transport_type);
  return html`
    <div class="stage-card tr-${s.transport_type}">
      <div class="stage-head">
        <span class="stage-num">${i + 1}</span>
        <span class="t-sub">${TRANSPORT[s.transport_type]}</span>
        <span class="t-caption" data-stage-time="${i}">${times?.[i] ?? ''}</span>
        ${st.stages.length > 1 ? html`<button class="icon-btn" data-action="past-remove" data-i="${i}" aria-label="Удалить этап ${i + 1}">${ICONS.trash}</button>` : ''}
      </div>
      <div class="chips scroll" role="group" aria-label="Транспорт этапа ${i + 1}">${ORDER.map((t) => html`
        <button class="chip tr-${t} ${t === s.transport_type ? 'on' : ''}" aria-pressed="${t === s.transport_type}" data-action="past-transport" data-i="${i}" data-value="${t}">${TRANSPORT_ICONS[t]}${TRANSPORT[t]}</button>`)}</div>
      <div class="stage-fields">
        ${TICKETED.has(s.transport_type) ? html`<label class="field"><span>Номер</span><input data-field="past.${i}.number" value="${s.transport_number}" placeholder="720" autocomplete="off"></label>` : ''}
        ${free ? '' : html`<label class="field"><span>Цена, ₴</span><input inputmode="decimal" data-field="past.${i}.cost" value="${s.cost ? moneyToInput(s.cost) : ''}" placeholder="0" autocomplete="off"></label>`}
        <label class="field"><span>Минут</span><input inputmode="numeric" data-field="past.${i}.minutes" value="${s.minutes ?? ''}" placeholder="15" autocomplete="off"></label>
      </div>
      <div class="chips">${MINUTE_CHIPS.map((m) => html`<button class="chip ${m === s.minutes ? 'on' : ''}" data-action="past-minutes" data-i="${i}" data-value="${m}">${m} мин</button>`)}</div>
    </div>`;
}

/** Обновить время этапов и итог без перерисовки (чтобы не терять поле, в котором печатают). */
function refresh(app) {
  const st = app.ui.past;
  const c = computed(st);
  document.querySelectorAll('[data-stage-time]').forEach((el) => { el.textContent = c?.times[+el.dataset.stageTime] ?? ''; });
  const sum = document.querySelector('[data-past-summary]');
  if (sum) sum.textContent = summaryText(c, st);
}

export const pastTripView = {
  tab: 'analytics',
  init(app) {
    app.ui.past = freshState(app);
  },
  // Выбранный транспорт этапа — в видимой части ленты
  mount(app, root) {
    for (const row of root.querySelectorAll('.stage-card .chips.scroll')) {
      const on = row.querySelector('.chip.on');
      if (on) row.scrollLeft = Math.max(0, on.offsetLeft - row.offsetLeft - 24);
    }
  },
  render(app) {
    const st = app.ui.past ??= freshState(app);
    const { store } = app;
    const c = computed(st);
    const today = dateInput(Date.now());
    const days = [0, 1, 2].map((k) => dateInput(addDays(startOfDay(Date.now()), -k)));
    const routes = store.live('routes').filter((r) => r.segments.length);
    const last = lastTrip(store, st.direction);
    return html`
      ${topBar('Прошлая поездка', { back: '#/analytics' })}
      <div class="stack-lg reveal">
        <p class="t-callout muted">Поездка задним числом целиком — с каждым этапом. Время этапов посчитается само.</p>
        ${segmented(DIRECTIONS, st.direction, { action: 'past-direction', label: 'Направление' })}

        <div class="grid-2">
          <label class="field" style="margin:0"><span>Дата</span><input type="date" data-field="past.date" value="${st.date}" max="${today}"></label>
          <label class="field" style="margin:0"><span>Выезд</span><input type="time" data-field="past.start" value="${st.start}"></label>
        </div>
        <div class="chips" style="margin-top:calc(-1 * var(--s-3))">${['Сегодня', 'Вчера', 'Позавчера'].map((label, k) => html`
          <button class="chip ${st.date === days[k] ? 'on' : ''}" data-action="past-day" data-value="${days[k]}">${label}</button>`)}</div>

        ${last || routes.length ? html`<div>
          <p class="t-caption" style="margin-bottom:var(--s-2)">Заполнить как</p>
          <div class="chips scroll">
            ${last ? html`<button class="chip" data-action="past-like-last">${ICONS.repeat}Прошлая: ${formatDateTime(last.started_at)}</button>` : ''}
            ${routes.map((r) => html`<button class="chip" data-action="past-like-route" data-id="${r.id}">${ICONS.route}${r.name}</button>`)}
          </div></div>` : ''}

        <section aria-label="Этапы">
          <div class="stages">${st.stages.map((s, i) => html`${i ? html`<div class="stage-link" aria-hidden="true">пересадка</div>` : ''}${stageCard(st, s, i, c?.times)}`)}</div>
          ${secondaryButton('Добавить этап — пересадка', { action: 'past-add', icon: ICONS.plus })}
        </section>

        <label class="field" style="margin:0"><span>Комментарий</span><input data-field="past.comment" value="${st.comment}" placeholder="Необязательно"></label>

        <div class="past-summary">
          <span class="t-caption">Итог</span>
          <strong class="t-sub" data-past-summary>${summaryText(c, st)}</strong>
        </div>
        ${primaryButton('Добавить поездку', { action: 'past-save', icon: ICONS.check })}
      </div>`;
  },
  onInput(app, el) {
    const st = app.ui.past;
    const [, a, b] = el.dataset.field.split('.');
    if (a === 'date') st.date = el.value;
    else if (a === 'start') st.start = el.value;
    else if (a === 'comment') st.comment = el.value;
    else {
      const s = st.stages[+a];
      if (!s) return false;
      if (b === 'number') s.transport_number = el.value;
      if (b === 'cost') {
        const v = el.value.trim() === '' ? 0 : parseMoney(el.value);
        el.classList.toggle('invalid', v == null);
        if (v != null) s.cost = v;
      }
      if (b === 'minutes') {
        const v = Number(el.value);
        const ok = el.value.trim() !== '' && Number.isInteger(v) && v >= 1 && v <= 600;
        el.classList.toggle('invalid', !ok && el.value.trim() !== '');
        s.minutes = ok ? v : null;
      }
    }
    refresh(app);
    return false;
  },
  actions: {
    'past-direction': (app, el) => {
      const st = app.ui.past;
      const s = sample(app.store, el.dataset.value);
      Object.assign(st, { direction: el.dataset.value, start: timeInput(s.start), stages: s.stages });
      app.haptic();
      app.rerender();
    },
    'past-day': (app, el) => { app.ui.past.date = el.dataset.value; app.haptic(); app.rerender(); },
    'past-like-last': (app) => {
      const st = app.ui.past;
      const s = sample(app.store, st.direction);
      Object.assign(st, { start: timeInput(s.start), stages: s.stages });
      app.haptic();
      app.rerender();
    },
    'past-like-route': (app, el) => {
      const r = app.store.data.routes.get(el.dataset.id);
      const st = app.ui.past;
      st.direction = r.direction;
      st.stages = r.segments.map((x) => ({ transport_type: x.transport_type, transport_number: x.transport_number ?? '', cost: x.cost || 0, minutes: 15 }));
      app.haptic();
      app.rerender();
      app.toast('Этапы из шаблона — проверьте минуты каждого этапа');
    },
    'past-transport': (app, el) => {
      const s = app.ui.past.stages[+el.dataset.i];
      s.transport_type = el.dataset.value;
      if (FREE.has(s.transport_type)) s.cost = 0;
      if (!TICKETED.has(s.transport_type)) s.transport_number = '';
      app.haptic();
      app.rerender();
    },
    'past-minutes': (app, el) => { app.ui.past.stages[+el.dataset.i].minutes = +el.dataset.value; app.haptic(); app.rerender(); },
    'past-add': (app) => {
      const st = app.ui.past;
      const prev = st.stages.at(-1);
      st.stages.push({ transport_type: prev?.transport_type === 'walk' ? 'minibus' : 'walk', transport_number: '', cost: 0, minutes: prev?.transport_type === 'walk' ? 20 : 5 });
      app.haptic();
      app.rerender();
    },
    'past-remove': (app, el) => { app.ui.past.stages.splice(+el.dataset.i, 1); app.haptic(); app.rerender(); },
    'past-save': async (app) => {
      const st = app.ui.past;
      const date = parseDateInput(st.date);
      const start = parseTimeInput(st.start);
      if (!date) throw new Error('Укажите дату поездки');
      if (start == null) throw new Error('Укажите время выезда');
      const built = buildPastTrip({ date, startMinute: start, stages: st.stages.map((s) => ({ ...s, cost: FREE.has(s.transport_type) ? 0 : s.cost || 0 })) });
      const { store } = app;
      const d = store.emptyDraft();
      Object.assign(d, { direction: st.direction, started_at: built.started_at, finished_at: built.finished_at, comment: st.comment });
      d.segments = built.segments.map((s) => ({
        ...store.newSegmentDraft({ transport_type: s.transport_type, transport_number: s.transport_number || '', cost: s.cost }),
        started_at: s.started_at, finished_at: s.finished_at,
      }));
      const id = await store.saveTrip(d);
      app.haptic('success');
      app.ui.past = null;
      app.toast(`Добавлено: ${formatDateTime(built.started_at)}–${formatTime(built.finished_at)} · ${formatMoney(store.tripCost(store.trip(id)))}`, {
        action: 'Отменить', run: async () => { await store.deleteTrip(id); app.toast('Поездка удалена'); },
      });
      app.navigate('#/analytics');
    },
  },
};
