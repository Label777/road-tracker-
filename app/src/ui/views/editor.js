// Редактор поездки: время, направление, шаблон, этапы (транспорт, номер, время, стоимость,
// расстояние, контролёр), «без разбивки», комментарий. Также подтверждение автопоездок.
import { html } from '../html.js';
import { topBar, card } from '../components.js';
import { formatMoney, parseMoney, moneyToInput } from '../../core/money.js';
import { formatDuration } from '../../core/time.js';
import { issueMessage } from '../../core/editing.js';
import { DIRECTIONS, TRANSPORT, TICKETED, OUTCOME_LABELS, ICONS, toInputDateTime, fromInputDateTime } from '../format.js';
import { mapView } from '../map.js';

const opt = (value, label, selected) => html`<option value="${value}" ${selected ? 'selected' : ''}>${label}</option>`;

function inspectionFields(insp, prefix) {
  return html`
    <label class="toggle"><input type="checkbox" data-field="${prefix}.on" ${insp ? 'checked' : ''}><span>Отметить наблюдение контролёра</span></label>
    ${insp ? html`
      <label>Что было<select data-field="${prefix}.outcome">${Object.entries(OUTCOME_LABELS).map(([k, v]) => opt(k, v, k === insp.outcome))}</select></label>
      ${insp.outcome !== 'no_controller' ? html`
        <label>Время<input type="datetime-local" data-field="${prefix}.observed_at" value="${toInputDateTime(insp.observed_at)}"></label>
        <label>Где (станция, остановка)<input data-field="${prefix}.comment" value="${insp.comment}"></label>` : ''}
    ` : ''}`;
}

function segmentCard(seg, i, count) {
  return html`
    <fieldset class="segment">
      <legend>Этап ${i + 1}</legend>
      <div class="grid2">
        <label>Транспорт<select data-field="seg.${i}.transport_type">${Object.entries(TRANSPORT).map(([k, v]) => opt(k, v, k === seg.transport_type))}</select></label>
        <label>Номер<input data-field="seg.${i}.transport_number" value="${seg.transport_number}" placeholder="720" autocomplete="off"></label>
      </div>
      <label>Название линии / направление<input data-field="seg.${i}.route_name" value="${seg.route_name}"></label>
      <div class="grid2 dt">
        <label>Отправление<input type="datetime-local" data-field="seg.${i}.started_at" value="${toInputDateTime(seg.started_at)}"></label>
        <label>Прибытие<input type="datetime-local" data-field="seg.${i}.finished_at" value="${toInputDateTime(seg.finished_at)}"></label>
      </div>
      <div class="grid2">
        <label>Стоимость, ₴<input inputmode="decimal" data-field="seg.${i}.cost" value="${moneyToInput(seg.cost)}" placeholder="0"></label>
        <label>Расстояние, км<input inputmode="decimal" data-field="seg.${i}.km" value="${seg.distance_meters != null ? String(seg.distance_meters / 1000).replace('.', ',') : ''}"></label>
      </div>
      <label>Комментарий<input data-field="seg.${i}.comment" value="${seg.comment}"></label>
      ${TICKETED.has(seg.transport_type) ? inspectionFields(seg.inspection, `seg.${i}.insp`) : ''}
      <div class="btn-row small">
        <button class="btn small" data-action="seg-up" data-i="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="btn small" data-action="seg-down" data-i="${i}" ${i === count - 1 ? 'disabled' : ''}>↓</button>
        <button class="btn small danger" data-action="seg-remove" data-i="${i}">Удалить этап</button>
      </div>
    </fieldset>`;
}

function issuesBlock(app, d) {
  const issues = app.store.draftIssues(d);
  return html`<div id="editor-issues">${issues.map((i) => html`<p class="${i.blocking ? 'error' : 'warn'} small">${i.message ?? issueMessage(i)}</p>`)}</div>`;
}

const totalOf = (d) => d.extra_cost + d.segments.reduce((a, s) => a + (s.cost || 0), 0);

export const editorView = {
  editor: true,
  tab: 'history',
  /** params: {id} существующей поездки | {route} шаблона | {} новая */
  init(app, params) {
    const { store } = app;
    if (params.id) {
      const trip = store.trip(params.id);
      app.ui.draft = trip ? store.draftFromTrip(trip) : null;
    } else if (params.route) {
      const r = store.data.routes.get(params.route);
      app.ui.draft = r ? store.draftFromRoute(r) : store.emptyDraft();
    } else {
      app.ui.draft = store.emptyDraft();
    }
  },
  render(app, params) {
    const d = app.ui.draft;
    if (!d) return html`${topBar('Поездка', { back: '#/history' })}<p class="empty">Поездка не найдена.</p>`;
    const { store } = app;
    const routes = store.live('routes').sort((a, b) => a.name.localeCompare(b.name));
    const suggested = d.status === 'suggested';
    const track = d.id ? store.trackOf(d.id) : [];
    const transfers = Math.max(0, d.segments.filter((s) => s.transport_type !== 'walk').length - 1);

    return html`
      ${topBar(d.id ? 'Поездка' : 'Новая поездка', {
        back: params.back || '#/history',
        actions: html`<button class="btn small primary" data-action="save">${suggested ? 'Подтвердить' : 'Сохранить'}</button>`,
      })}
      <div class="stack form">
        ${suggested ? html`<p class="notice notice-warning">Поездка добавлена автоматически. Проверьте время и сохраните — или удалите, если поездки не было.</p>` : ''}
        ${card(null, html`
          <label>Направление<select data-field="direction">${Object.entries(DIRECTIONS).map(([k, v]) => opt(k, v, k === d.direction))}</select></label>
          <div class="grid2 dt">
            <label>Начало<input type="datetime-local" data-field="started_at" value="${toInputDateTime(d.started_at)}"></label>
            <label>Окончание<input type="datetime-local" data-field="finished_at" value="${toInputDateTime(d.finished_at)}"></label>
          </div>
          <p class="muted small" id="editor-duration">В пути: ${formatDuration(Math.max(0, d.finished_at - d.started_at))}</p>
          ${routes.length ? html`
            <label>Шаблон маршрута<select data-field="route_id">${opt('', 'Без шаблона', !d.route_id)}${routes.map((r) => opt(r.id, r.name, r.id === d.route_id))}</select></label>
            ${d.route_id && !d.segments.length ? html`<button class="btn small" data-action="fill-template">Заполнить этапы из шаблона</button>` : ''}` : ''}
        `)}

        ${card(`Этапы маршрута · пересадок: ${transfers}`, html`
          ${d.segments.map((s, i) => segmentCard(s, i, d.segments.length))}
          <button class="btn" data-action="seg-add">${ICONS.plus} Добавить этап</button>
        `)}

        ${card('Стоимость', html`
          <label>Без разбивки по этапам, ₴<input inputmode="decimal" data-field="extra_cost" value="${moneyToInput(d.extra_cost)}" placeholder="0"></label>
          <p class="total">Итого: <strong id="editor-total" class="mono">${formatMoney(totalOf(d))}</strong></p>
        `)}

        ${!d.segments.length ? card('Контролёр', inspectionFields(d.trip_inspection, 'tripinsp')) : ''}

        ${card('Комментарий', html`<textarea data-field="comment" rows="2" placeholder="Например: пробка на мосту">${d.comment}</textarea>`)}

        ${track.length > 1 ? card('Маршрут по GPS', html`<div class="map" data-map-track="${d.id}"></div>`) : ''}

        ${issuesBlock(app, d)}
        ${d.id ? html`<button class="link danger center" data-action="delete">Удалить поездку</button>` : ''}
      </div>`;
  },
  mount(app, root) {
    const el = root.querySelector('[data-map-track]');
    if (el) mapView(el, { track: app.store.trackOf(el.dataset.mapTrack) });
  },
  /** Возвращает true, если нужна полная перерисовка (изменилась структура формы). */
  onInput(app, el) {
    const d = app.ui.draft;
    const f = el.dataset.field;
    const v = el.type === 'checkbox' ? el.checked : el.value;
    const money = (text) => {
      const m = parseMoney(text || '0');
      el.classList.toggle('invalid', m == null);
      return m;
    };
    let structural = false;

    const setInspection = (holder, key, sub) => {
      if (sub === 'on') {
        holder[key] = v ? { id: crypto.randomUUID(), outcome: 'no_controller', observed_at: holder.started_at ?? d.started_at, comment: '' } : null;
        structural = true;
      } else if (holder[key]) {
        if (sub === 'outcome') { holder[key].outcome = v; structural = true; }
        if (sub === 'observed_at') holder[key].observed_at = fromInputDateTime(v) ?? holder[key].observed_at;
        if (sub === 'comment') holder[key].comment = v;
      }
    };

    if (f === 'direction') d.direction = v;
    else if (f === 'started_at' || f === 'finished_at') d[f] = fromInputDateTime(v) ?? d[f];
    else if (f === 'route_id') { d.route_id = v || null; structural = true; }
    else if (f === 'extra_cost') { const m = money(v); if (m != null) d.extra_cost = m; }
    else if (f === 'comment') d.comment = v;
    else if (f.startsWith('tripinsp.')) setInspection(d, 'trip_inspection', f.split('.')[1]);
    else if (f.startsWith('seg.')) {
      const [, i, key, sub] = f.split('.');
      const seg = d.segments[+i];
      if (key === 'insp') setInspection(seg, 'inspection', sub);
      else if (key === 'cost') { const m = money(v); if (m != null) seg.cost = m; }
      else if (key === 'km') {
        const km = v.trim() === '' ? null : Number(v.replace(',', '.'));
        el.classList.toggle('invalid', km != null && !(km >= 0));
        seg.distance_meters = km != null && km >= 0 ? Math.round(km * 1000) : null;
      } else if (key === 'started_at' || key === 'finished_at') seg[key] = fromInputDateTime(v);
      else {
        seg[key] = v;
        if (key === 'transport_type') structural = true;
      }
    }

    if (structural) return true;
    // Частичное обновление без потери фокуса
    const root = el.closest('main');
    root.querySelector('#editor-total').textContent = formatMoney(totalOf(d));
    root.querySelector('#editor-duration').textContent = `В пути: ${formatDuration(Math.max(0, d.finished_at - d.started_at))}`;
    root.querySelector('#editor-issues').outerHTML = issuesBlock(app, d).toString();
    return false;
  },
  actions: {
    save: async (app) => {
      try {
        await app.store.saveTrip(app.ui.draft);
        app.toast('Сохранено');
        app.back();
      } catch (e) {
        app.toast(e.message);
      }
    },
    delete: async (app) => {
      if (!confirm('Удалить поездку?')) return;
      await app.store.deleteTrip(app.ui.draft.id);
      app.back();
    },
    'fill-template': (app) => {
      const r = app.store.data.routes.get(app.ui.draft.route_id);
      if (r) {
        app.ui.draft.segments = r.segments.map((s) => app.store.newSegmentDraft(s));
        app.ui.draft.direction = r.direction;
      }
      app.rerender();
    },
    'seg-add': (app) => {
      const d = app.ui.draft;
      const last = d.segments.at(-1);
      const seg = app.store.newSegmentDraft({ transport_type: last?.transport_type === 'metro' ? 'walk' : 'minibus' });
      seg.started_at = last?.finished_at ?? null;
      d.segments.push(seg);
      app.rerender();
    },
    'seg-remove': (app, el) => { app.ui.draft.segments.splice(+el.dataset.i, 1); app.rerender(); },
    'seg-up': (app, el) => move(app, +el.dataset.i, -1),
    'seg-down': (app, el) => move(app, +el.dataset.i, 1),
  },
};

function move(app, i, delta) {
  const s = app.ui.draft.segments;
  const j = i + delta;
  if (j < 0 || j >= s.length) return;
  [s[i], s[j]] = [s[j], s[i]];
  app.rerender();
}
