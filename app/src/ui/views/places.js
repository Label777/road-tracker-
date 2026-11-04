// Места (Дом, Работа, другие) и шаблоны маршрутов.
import { html } from '../html.js';
import { topBar, group, cell, emptyState, secondaryButton } from '../components.js';
import { html as _h } from '../html.js';

const card = (title, body) => _h`<section>${title ? _h`<h2 class="group-title">${title}</h2>` : ''}<div class="surface">${body}</div></section>`;
import { formatMoney, parseMoney, moneyToInput } from '../../core/money.js';
import { DIRECTIONS, TRANSPORT, TRANSPORT_ICONS, PLACE_KINDS, ICONS } from '../format.js';
import { mapView, geocode } from '../map.js';

// ------------------------------------------------------------------ места

export const placesView = {
  tab: 'profile',
  render(app) {
    const places = app.store.live('locations').sort((a, b) => a.name.localeCompare(b.name));
    const byKind = (k) => places.find((p) => p.kind === k);
    const placeCell = (p) => cell({
      icon: p.kind === 'home' ? ICONS.home : p.kind === 'work' ? ICONS.work : ICONS.pin, title: p.name,
      sub: `${p.address || `${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)}`} · ${p.radius} м`, href: `#/place/${p.id}`,
    });
    return html`
      ${topBar('Места', { back: '#/profile' })}
      <div class="stack-lg reveal">
        ${group('Дом и работа', html`${['home', 'work'].map((k) => (byKind(k) ? placeCell(byKind(k))
          : cell({ icon: k === 'home' ? ICONS.home : ICONS.work, title: `Указать: ${PLACE_KINDS[k]}`, href: `#/place/new-${k}` })))}`,
        'Во время поездки с GPS сайт предложит завершить её, когда вы окажетесь в одном из мест.')}
        ${group('Другие места', html`
          ${places.filter((p) => p.kind === 'other').map(placeCell)}
          ${cell({ icon: ICONS.plus, title: 'Добавить место', href: '#/place/new-other' })}`)}
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
      ${topBar(p.id ? p.name : 'Новое место', { back: '#/places', actions: html`<button class="btn btn-primary btn-sm" data-action="save">Сохранить</button>` })}
      <div class="stack-lg reveal">
        ${card(null, html`
          <div class="map picker" id="place-map"></div>
          <form class="btn-row" style="margin:var(--s-3) 0" data-action="search"><input name="q" placeholder="Найти адрес" autocomplete="off" enterkeyhint="search" aria-label="Адрес"><button class="btn btn-secondary btn-sm" type="submit">Найти</button></form>
          ${secondaryButton('Я здесь', { action: 'here', icon: ICONS.gps, size: 'sm' })}
          <p class="t-caption" id="coords" style="margin-top:var(--s-2)">Двигайте карту, чтобы поставить метку: ${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}</p>
        `)}
        ${card(null, html`
          <label class="field"><span>Тип</span><select data-field="kind">${Object.entries(PLACE_KINDS).map(([k, v]) => html`<option value="${k}" ${k === p.kind ? 'selected' : ''}>${v}</option>`)}</select></label>
          <label class="field"><span>Название</span><input data-field="name" value="${p.name}" required></label>
          <label class="field"><span>Адрес</span><input data-field="address" value="${p.address}"></label>
          <div class="grid-2">
            <label class="field"><span>Широта</span><input inputmode="decimal" data-field="latitude" value="${p.latitude}"></label>
            <label class="field"><span>Долгота</span><input inputmode="decimal" data-field="longitude" value="${p.longitude}"></label>
          </div>
          <label class="field"><span>Радиус геозоны: <output id="radius-out">${p.radius}</output> м</span><input type="range" min="100" max="2000" step="50" data-field="radius" value="${p.radius}"></label>
          <p class="t-caption">Точность определения места — около 100 м, поэтому радиус меньше не используется.</p>
        `)}
        ${p.id ? html`<button class="btn btn-danger" style="width:100%" data-action="delete">Удалить место</button>` : ''}
      </div>`;
  },
  async mount(app, root) {
    const p = app.ui.place;
    const ctl = await mapView(root.querySelector('#place-map'), {
      center: { lat: p.latitude, lon: p.longitude }, radius: p.radius,
      onMove: (c) => {
        p.latitude = +c.lat.toFixed(6);
        p.longitude = +c.lon.toFixed(6);
        // Карта могла пережить перерисовку или уход с экрана — обновляем только живые поля
        const coords = root.querySelector('#coords');
        if (coords) coords.textContent = `Метка: ${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`;
        const lat = root.querySelector('[data-field=latitude]');
        const lon = root.querySelector('[data-field=longitude]');
        if (lat) lat.value = p.latitude;
        if (lon) lon.value = p.longitude;
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
      if (!(await app.confirm({ title: 'Удалить место?', confirm: 'Удалить', danger: true }))) return;
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
      <div class="stack-lg reveal">
        ${routes.length ? '' : emptyState({ icon: ICONS.route, title: 'Шаблонов пока нет', text: 'Например: «Утро: маршрутка 720 → метро». Шаблон запускает поездку в одно касание и подсказывает следующий этап.' })}
        ${group(routes.length ? 'Ваши маршруты' : '', html`
          ${routes.map((r) => cell({ icon: r.direction === 'to_home' ? ICONS.home : ICONS.work, title: r.name,
            sub: `${DIRECTIONS[r.direction]} · ${summary(r)}`, value: formatMoney(r.segments.reduce((a, s) => a + s.cost, 0)), href: `#/route/${r.id}` }))}
          ${cell({ icon: ICONS.plus, title: 'Новый маршрут', href: '#/route/new' })}`)}
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
    const placeSelect = (field, label) => html`<label class="field"><span>${label}</span><select data-field="${field}"><option value="">Не указано</option>
      ${places.map((p) => html`<option value="${p.id}" ${p.id === r[field] ? 'selected' : ''}>${p.name}</option>`)}</select></label>`;
    return html`
      ${topBar(r.id ? r.name : 'Новый маршрут', { back: '#/routes', actions: html`<button class="btn btn-primary btn-sm" data-action="save">Сохранить</button>` })}
      <div class="stack-lg reveal">
        ${card(null, html`
          <label class="field"><span>Название</span><input data-field="name" value="${r.name}" placeholder="Утро: 720 + метро"></label>
          <label class="field"><span>Направление</span><select data-field="direction">${Object.entries(DIRECTIONS).map(([k, v]) => html`<option value="${k}" ${k === r.direction ? 'selected' : ''}>${v}</option>`)}</select></label>
          <div class="grid-2">${placeSelect('origin_id', 'Откуда')}${placeSelect('destination_id', 'Куда')}</div>`)}
        ${card('Этапы', html`
          ${r.segments.map((s, i) => html`
            <div class="seg-row" style="display:grid;grid-template-columns:1.4fr .8fr .9fr 40px;gap:var(--s-2);margin-bottom:var(--s-2);align-items:center">
              <select data-field="seg.${i}.transport_type" aria-label="Транспорт">${Object.entries(TRANSPORT).map(([k, v]) => html`<option value="${k}" ${k === s.transport_type ? 'selected' : ''}>${v}</option>`)}</select>
              <input data-field="seg.${i}.transport_number" value="${s.transport_number}" placeholder="№" aria-label="Номер">
              <input inputmode="decimal" data-field="seg.${i}.cost" value="${moneyToInput(s.cost)}" placeholder="₴" aria-label="Стоимость">
              <button class="icon-btn" data-action="seg-remove" data-i="${i}" aria-label="Удалить этап">${ICONS.close}</button>
            </div>`)}
          ${r.segments.length < 12 ? secondaryButton('Добавить этап', { action: 'seg-add', icon: ICONS.plus }) : ''}
          <div class="row-between" style="margin-top:var(--s-4)"><span class="t-sub">Типичная стоимость</span><strong id="route-total" class="t-num-lg">${formatMoney(r.segments.reduce((a, s) => a + s.cost, 0))}</strong></div>`)}
        ${r.id ? html`<button class="btn btn-danger" style="width:100%" data-action="delete">Удалить шаблон</button>` : ''}
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
      if (!(await app.confirm({ title: 'Удалить шаблон?', text: 'Записанные поездки останутся.', confirm: 'Удалить', danger: true }))) return;
      await app.store.deleteRoute(app.ui.route.id);
      app.navigate('#/routes');
    },
    'seg-add': (app) => { app.ui.route.segments.push({ transport_type: 'metro', transport_number: '', cost: 0 }); app.rerender(); },
    'seg-remove': (app, el) => { app.ui.route.segments.splice(+el.dataset.i, 1); app.rerender(); },
  },
};
