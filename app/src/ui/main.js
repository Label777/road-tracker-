// Точка входа: хранилище, синхронизация, запись поездки, маршрутизация по #/hash, делегирование событий.
import { IdbBackend } from '../data/db.js';
import { Store } from '../data/store.js';
import { SupabaseClient, SyncManager } from '../data/sync.js';
import { Tracker } from './tracker.js';
import { formatDuration } from '../core/time.js';
import { html } from './html.js';
import { ICONS, formatClock } from './format.js';
import { DEFAULT_CONFIG } from '../config.js';
import { dashboard } from './views/dashboard.js';
import { tripView } from './views/trip.js';
import { editorView } from './views/editor.js';
import { historyView } from './views/history.js';
import { analyticsView } from './views/analytics.js';
import { profileView } from './views/profile.js';
import { placesView, placeEditorView, routesView, routeEditorView } from './views/places.js';

const ROUTES = [
  [/^#\/(home)?$/, dashboard],
  [/^#\/trip$/, tripView],
  [/^#\/history$/, historyView],
  [/^#\/analytics$/, analyticsView],
  [/^#\/profile$/, profileView],
  [/^#\/edit\/(?<id>[\w-]+)$/, editorView],
  [/^#\/new(?:\/(?<route>[\w-]+))?$/, editorView],
  [/^#\/places$/, placesView],
  [/^#\/place\/(?<id>[\w-]+)$/, placeEditorView],
  [/^#\/routes$/, routesView],
  [/^#\/route\/(?<id>[\w-]+)$/, routeEditorView],
];

const TABS = [
  ['home', '#/home', 'Главная', ICONS.home],
  ['trip', '#/trip', 'Поездка', ICONS.trip],
  ['history', '#/history', 'История', ICONS.history],
  ['analytics', '#/analytics', 'Аналитика', ICONS.analytics],
  ['profile', '#/profile', 'Профиль', ICONS.profile],
];

function loadConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem('rt.config') || 'null');
    const cfg = saved ?? DEFAULT_CONFIG;
    return cfg?.url && cfg?.anonKey ? cfg : null;
  } catch {
    return null;
  }
}

async function boot() {
  const main = document.querySelector('main');
  const store = new Store(new IdbBackend());
  try {
    await store.load();
  } catch (e) {
    main.innerHTML = html`<div class="stack"><p class="error">Не удалось открыть хранилище браузера: ${e.message}</p>
      <p class="muted small">В режиме «Частный доступ» Safari может блокировать хранение данных.</p></div>`.toString();
    return;
  }
  // Просим браузер не удалять данные при нехватке места (Safari может стирать данные сайтов).
  navigator.storage?.persist?.().catch(() => {});

  const config = loadConfig();
  const client = config ? new SupabaseClient(config) : null;
  const sync = new SyncManager(store, client);
  const tracker = new Tracker(store);

  const app = {
    store, client, sync, tracker, ui: {}, view: null, params: {}, history: [],
    rerender: () => render(true),
    navigate: (hash) => { location.hash = hash; },
    back: () => (app.history.length > 1 ? history.back() : app.navigate('#/history')),
    toast,
  };
  window.roadTracker = app; // для отладки и e2e-тестов

  let pending = false;
  let deferred = false;
  function render(force = false) {
    if (!force && app.view?.editor) return; // не сбрасывать форму, пока её заполняют
    // Фоновые обновления (синхронизация, GPS) не перерисовывают страницу, пока пользователь вводит текст
    const focused = document.activeElement;
    if (!force && main.contains(focused) && /^(INPUT|TEXTAREA|SELECT)$/.test(focused.tagName)) {
      deferred = true;
      return;
    }
    if (pending && !force) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      const scrollY = window.scrollY;
      main.innerHTML = app.view.render(app, app.params).toString();
      app.view.mount?.(app, main, app.params);
      if (force) window.scrollTo(0, scrollY);
      for (const a of document.querySelectorAll('nav.tabs a')) a.classList.toggle('on', a.dataset.tab === app.view.tab);
    });
  }

  function route() {
    const hash = location.hash || '#/home';
    for (const [re, view] of ROUTES) {
      const m = re.exec(hash);
      if (!m) continue;
      app.view = view;
      app.params = { ...(m.groups || {}), back: app.history.at(-1) };
      app.history.push(hash);
      view.init?.(app, app.params);
      window.scrollTo(0, 0);
      render(true);
      return;
    }
    app.navigate('#/home');
  }

  // ----- события
  main.addEventListener('click', async (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el || el.tagName === 'FORM') return;
    const name = el.dataset.action;
    const handler = app.view.actions?.[name] ?? GLOBAL_ACTIONS[name];
    if (!handler) return;
    ev.preventDefault();
    try {
      await handler(app, el, ev);
    } catch (e) {
      toast(e.message);
    }
  });

  main.addEventListener('submit', async (ev) => {
    const form = ev.target.closest('form[data-action]');
    if (!form) return;
    ev.preventDefault();
    const handler = app.view.actions?.[form.dataset.action];
    try {
      await handler?.(app, form, ev);
    } catch (e) {
      toast(e.message);
    }
  });

  // Текстовые поля — на каждый ввод; флажки, списки, даты — только на change (иначе двойное срабатывание)
  const onField = (ev) => {
    const el = ev.target.closest('[data-field]');
    if (!el || !app.view.onInput) return;
    const discrete = el.tagName === 'SELECT' || ['checkbox', 'radio', 'date', 'datetime-local', 'range'].includes(el.type);
    if (discrete && ev.type === 'input' && el.type !== 'range') return;
    if (el.type === 'range' && ev.type === 'change') return;
    if (app.view.onInput(app, el, ev.type)) render(true);
  };
  main.addEventListener('focusout', () => {
    if (deferred) setTimeout(() => { deferred = false; render(); }, 0);
  });
  main.addEventListener('input', onField);
  main.addEventListener('change', onField);

  const GLOBAL_ACTIONS = {
    'dismiss-notice': () => tracker.dismissNotice(),
    'open-trip': () => app.navigate('#/trip'),
    'quick-start': async () => {
      const { suggestedDirection } = await import('./views/dashboard.js');
      await tracker.send({ type: 'start', direction: suggestedDirection(), mode: 'manual' });
      app.navigate('#/trip');
    },
  };

  // ----- подписки
  store.subscribe(() => render());
  tracker.subscribe(() => render());
  sync.subscribe(() => { if (app.view === profileView) render(); });

  // Таймер поездки обновляется без перерисовки страницы
  setInterval(() => {
    if (!tracker.session) return;
    const ms = tracker.activeMs();
    for (const el of document.querySelectorAll('[data-timer]')) {
      el.textContent = el.dataset.timer === 'clock' ? formatClock(ms) : formatDuration(ms);
    }
  }, 1000);

  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => sync.request());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') tracker.flush();
    else {
      tracker.onVisible();
      sync.request();
      render();
    }
  });
  window.addEventListener('pagehide', () => tracker.flush());

  document.querySelector('nav.tabs').innerHTML = TABS.map(([tab, href, label, icon]) =>
    `<a href="${href}" data-tab="${tab}">${icon}<span>${label}</span></a>`).join('');

  route();
  store.purgeTrackPoints(30).catch(() => {});
  sync.request();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

let toastTimer;
function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

boot();
