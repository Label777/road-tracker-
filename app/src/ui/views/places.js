// Места (Дом, Работа, другие) и шаблоны маршрутов.
import { html } from '../html.js';
import { topBar, card, empty } from '../components.js';
import { formatMoney, parseMoney, moneyToInput } from '../../core/money.js';
import { DIRECTIONS, TRANSPORT, PLACE_KINDS, ICONS } from '../format.js';
import { mapView, geocode } from '../map.js';

// ------------------------------------------------------------------ места

export const placesView = {
  tab: 'profile',
  render(app) {
    const places = app.store.live('locations').sort((a, b) => a.name.localeCompare(b.name));
    const byKind = (k) => places.find((p) => p.kind === k);
    const row = (p) => html`<a class="row" href="#/place/${p.id}"><span class="row-icon">${p.kind === 'home' ? ICONS.home : ICONS.pin}</span>
      <span class="row-main"><span class="row-title">${p.name}</span><span class="row-sub">${p.address || `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`} · ${p.radius} м</span></span>${ICONS.chevron}</a>`;
    return html`
      ${topBar('Места', { back: '#/profile' })}
      <div class="stack">
        ${card(null, html`<div class="list">
          ${['home', 'work'].map((k) => (byKind(k) ? row(byKind(k)) : html`<a class="row accent" href="#/place/new-${k}">${ICONS.plus} Указать: ${PLACE_KINDS[k]}</a>`))}
        </div>
        <p class="muted small">Во время поездки с GPS сайт предложит завершить её, когда вы окажетесь в одном из мест.</p>`)}
        ${card('Другие места', html`<div class="list">
          ${places.filter((p) => p.kind === 'other').map(row)}
          <a class="row accent" href="#/place/new-other">${ICONS.plus} Добавить место</a>
        </div>`)}
      </div>`;
  },
};

export const placeEditorView = {
  editor: true,
  tab: 'profile',
  init(app, { id }) {
    const p = id && !id.startsWith('new-') ? app.store.data.locations.get(id) : null;
    const kind = id?.startsWith('new-') ? id.slice(4) : 'other';
    app.ui.place = p ? { ...p, address: p.address || '' } : {
      id: null, kind, name: kind === 'other' ? '' : PLACE_KINDS[kind], address: '', latitude: 50.4501, longitude: 30.5234, radius: 150,
    };
  },
  render(app) {
    const p = app.ui.place;
    return html`
      ${topBar(p.id ? p.name : 'Новое место', { back: '#/places', actions: html`<button class="btn small primary" data-action="save">Сохранить</button>` })}
      <div class="stack form">
        ${card(null, html`
          <div class="map picker" id="place-map"></div>
          <form class="search" data-action="search"><input name="q" placeholder="Найти адрес" autocomplete="off"><button class="btn small" type="submit">Найти</button></form>
          <button class="btn small" data-action="here">${ICONS.gps} Я здесь</button>
          <p class="muted small" id="coords">Двигайте карту, чтобы поставить метку: ${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}</p>
        `)}
        ${card(null, html`
          <label>Тип<select data-field="kind">${Object.entries(PLACE_KINDS).map(([k, v]) => html`<option value="${k}" ${k === p.kind ? 'selected' : ''}>${v}</option>`)}</select></label>
          <label>Название<input data-field="name" value="${p.name}" required></label>
          <label>Адрес<input data-field="address" value="${p.address}"></label>
          <div class="grid2">
            <label>Широта<input inputmode="decimal" data-field="latitude" value="${p.latitude}"></label>
            <label>Долгота<input inputmode="decimal" data-field="longitude" value="${p.longitude}"></label>
          </div>
          <label>Радиус, м: <output id="radius-out">${p.radius}</output><input type="range" min="100" max="2000" step="50" data-field="radius" value="${p.radius}"></label>
          <p class="muted small">Точность определения места — около 100 м, поэтому радиус меньше не используется.</p>
        `)}
        ${p.id ? html`<button class="link danger center" data-action="delete">Удалить место</button>` : ''}
      </div>`;
  },
  async mount(app, root) {
    const p = app.ui.place;
    const ctl = await mapView(root.querySelector('#place-map'), {
      center: { lat: p.latitude, lon: p.longitude }, radius: p.radius,
      onMove: (c) => {
        p.latitude = +c.lat.toFixed(6);
        p.longitude = +c.lon.toFixed(6);
        root.querySelector('#coords').textContent = `Метка: ${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`;
        root.querySelector('[data-field=latitude]').value = p.latitude;
        root.querySelector('[data-field=longitude]').value = p.longitude;
      },
    });
    app.ui.placeMap = ctl;
  },
  onInput(app, el) {
    const p = app.ui.place;
    const f = el.dataset.field;
    if (f === 'radius') {
      p.radius = +el.value;
      el.closest('main').querySelector('#radius-out').textContent = p.radius;
      app.ui.placeMap?.setRadius(p.radius);
    } else if (f === 'latitude' || f === 'longitude') {
      const v = Number(el.value.replace(',', '.'));
      const ok = Number.isFinite(v) && Math.abs(v) <= (f === 'latitude' ? 90 : 180);
      el.classList.toggle('invalid', !ok);
      if (ok) {
        p[f] = v;
        app.ui.placeMap?.setCenter({ lat: p.latitude, lon: p.longitude });
      }
    } else p[f] = el.value;
    return false;
  },
  actions: {
    save: async (app) => {
      try {
        await app.store.savePlace(app.ui.place);
        app.navigate('#/places');
      } catch (e) {
        app.toast(e.message);
      }
    },
    delete: async (app) => {
      if (!confirm('Удалить место?')) return;
      await app.store.deletePlace(app.ui.place.id);
      app.navigate('#/places');
    },
    search: async (app, form) => {
      const q = new FormData(form).get('q').trim();
      if (!q) return;
      try {
        const p = app.ui.place;
        const hit = await geocode(q, { lat: p.latitude, lon: p.longitude });
        if (!hit) return app.toast('Ничего не найдено');
        Object.assign(p, { latitude: hit.lat, longitude: hit.lon, address: p.address || hit.address, name: p.name || hit.name });
        app.rerender();
      } catch (e) {
        app.toast(e.message);
      }
      return undefined;
    },
    here: async (app) => {
      try {
        const c = await app.tracker.currentPosition();
        Object.assign(app.ui.place, { latitude: +c.lat.toFixed(6), longitude: +c.lon.toFixed(6) });
        app.rerender();
      } catch (e) {
        app.toast(e.message);
      }
    },
  },
};

// ------------------------------------------------------------------ шаблоны маршрутов

const summary = (r) => r.segments.map((s) => (s.transport_number ? `${TRANSPORT[s.transport_type]} ${s.transport_number}` : TRANSPORT[s.transport_type])).join(' → ');

export const routesView = {
  tab: 'profile',
  render(app) {
    const routes = app.store.live('routes').sort((a, b) => a.name.localeCompare(b.name));
    return html`
      ${topBar('Шаблоны маршрутов', { back: '#/profile' })}
      <div class="stack">
        ${card(null, html`
          ${routes.length ? '' : empty('Например: «Утро: маршрутка 720 → метро». Шаблон ускоряет запись поездки и подсказывает следующий этап.')}
          <div class="list">
            ${routes.map((r) => html`<a class="row" href="#/route/${r.id}"><span class="row-main"><span class="row-title">${r.name}</span>
              <span class="row-sub">${DIRECTIONS[r.direction]} · ${summary(r)}</span></span>
              <span class="row-end mono">${formatMoney(r.segments.reduce((a, s) => a + s.cost, 0))}</span></a>`)}
            <a class="row accent" href="#/route/new">${ICONS.plus} Новый маршрут</a>
          </div>`)}
      </div>`;
  },
};

export const routeEditorView = {
  editor: true,
  tab: 'profile',
  init(app, { id }) {
    const r = id && id !== 'new' ? app.store.data.routes.get(id) : null;
    app.ui.route = r ? structuredClone(r) : {
      id: null, name: '', direction: 'to_work', origin_id: null, destination_id: null,
      segments: [{ transport_type: 'minibus', transport_number: '', cost: 0 }],
    };
    for (const s of app.ui.route.segments) s.transport_number ??= '';
  },
  render(app) {
    const r = app.ui.route;
    const places = app.store.live('locations');
    const placeSelect = (field, label) => html`<label>${label}<select data-field="${field}"><option value="">Не указано</option>
      ${places.map((p) => html`<option value="${p.id}" ${p.id === r[field] ? 'selected' : ''}>${p.name}</option>`)}</select></label>`;
    return html`
      ${topBar(r.id ? r.name : 'Новый маршрут', { back: '#/routes', actions: html`<button class="btn small primary" data-action="save">Сохранить</button>` })}
      <div class="stack form">
        ${card(null, html`
          <label>Название<input data-field="name" value="${r.name}" placeholder="Утро: 720 + метро"></label>
          <label>Направление<select data-field="direction">${Object.entries(DIRECTIONS).map(([k, v]) => html`<option value="${k}" ${k === r.direction ? 'selected' : ''}>${v}</option>`)}</select></label>
          <div class="grid2">${placeSelect('origin_id', 'Откуда')}${placeSelect('destination_id', 'Куда')}</div>`)}
        ${card('Этапы', html`
          ${r.segments.map((s, i) => html`
            <div class="grid3 seg-row">
              <select data-field="seg.${i}.transport_type" aria-label="Транспорт">${Object.entries(TRANSPORT).map(([k, v]) => html`<option value="${k}" ${k === s.transport_type ? 'selected' : ''}>${v}</option>`)}</select>
              <input data-field="seg.${i}.transport_number" value="${s.transport_number}" placeholder="№" aria-label="Номер">
              <input inputmode="decimal" data-field="seg.${i}.cost" value="${moneyToInput(s.cost)}" placeholder="₴" aria-label="Стоимость">
              <button class="icon-btn danger" data-action="seg-remove" data-i="${i}" aria-label="Удалить этап">×</button>
            </div>`)}
          ${r.segments.length < 12 ? html`<button class="btn" data-action="seg-add">${ICONS.plus} Добавить этап</button>` : ''}
          <p class="total">Типичная стоимость: <strong id="route-total" class="mono">${formatMoney(r.segments.reduce((a, s) => a + s.cost, 0))}</strong></p>`)}
        ${r.id ? html`<button class="link danger center" data-action="delete">Удалить шаблон</button>` : ''}
      </div>`;
  },
  onInput(app, el) {
    const r = app.ui.route;
    const f = el.dataset.field;
    if (f.startsWith('seg.')) {
      const [, i, key] = f.split('.');
      if (key === 'cost') {
        const m = parseMoney(el.value || '0');
        el.classList.toggle('invalid', m == null);
        if (m != null) r.segments[+i].cost = m;
        el.closest('main').querySelector('#route-total').textContent = formatMoney(r.segments.reduce((a, s) => a + s.cost, 0));
      } else r.segments[+i][key] = el.value;
    } else r[f] = el.value || (f.endsWith('_id') ? null : '');
    return false;
  },
  actions: {
    save: async (app) => {
      try {
        await app.store.saveRoute(app.ui.route);
        app.navigate('#/routes');
      } catch (e) {
        app.toast(e.message);
      }
    },
    delete: async (app) => {
      if (!confirm('Удалить шаблон? Записанные поездки останутся.')) return;
      await app.store.deleteRoute(app.ui.route.id);
      app.navigate('#/routes');
    },
    'seg-add': (app) => { app.ui.route.segments.push({ transport_type: 'metro', transport_number: '', cost: 0 }); app.rerender(); },
    'seg-remove': (app, el) => { app.ui.route.segments.splice(+el.dataset.i, 1); app.rerender(); },
  },
};
