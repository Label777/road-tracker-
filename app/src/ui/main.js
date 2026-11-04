// Точка входа: хранилище, синхронизация, запись поездки, маршрутизация по #/hash,
// делегирование событий (экран + нижняя шторка), шторки подтверждения, тактильный отклик.
import { IdbBackend } from '../data/db.js';
import { Store } from '../data/store.js';
import { SupabaseClient, SyncManager } from '../data/sync.js';
import { Tracker } from './tracker.js';
import { formatDuration } from '../core/time.js';
import { html } from './html.js';
import { ICONS, formatClock } from './format.js';
import { haptic } from './haptics.js';
import { openSheet, closeSheet, renderSheet, confirmSheet, trackKeyboard } from './sheet.js';
import { DEFAULT_CONFIG } from '../config.js';
import { dashboard, quickStart } from './views/dashboard.js';
import { tripView } from './views/trip.js';
import { editorView } from './views/editor.js';
import { historyView } from './views/history.js';
import { analyticsView } from './views/analytics.js';
import { profileView } from './views/profile.js';
import { placesView, placeEditorView, routesView, routeEditorView } from './views/places.js';
import { designView } from './views/design.js';
import { openQuickAdd } from './views/quick-add.js';

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
  [/^#\/design$/, designView],
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
    main.innerHTML = html`<div class="empty-state"><span class="art">${ICONS.lock}</span>
      <strong class="t-sub">Не удалось открыть хранилище браузера</strong>
      <p class="t-callout">${e.message}</p>
      <p class="t-caption">В режиме «Частный доступ» Safari может блокировать хранение данных. Откройте сайт в обычной вкладке.</p></div>`.toString();
    return;
  }
  // Просим браузер не удалять данные при нехватке места.
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
    haptic,
    settings: () => ({ gpsByDefault: false, finishHints: true, notifications: false, ...store.meta('settings', {}) }),
    saveSettings: (patch) => store.setMeta('settings', { ...app.settings(), ...patch }),
    confirm: (opts) => confirmSheet(app, opts),
    openSheet: (sheet) => openSheet(app, sheet),
    closeSheet: (result) => closeSheet(app, result),
    renderSheet: () => renderSheet(app),
    quickAdd: (opts) => openQuickAdd(app, opts),
  };
  window.roadTracker = app; // для отладки и e2e-тестов

  let pending = false;
  let deferred = false;
  function render(force = false) {
    const focused = document.activeElement;
    const typing = (root) => root.contains(focused) && /^(INPUT|TEXTAREA|SELECT)$/.test(focused.tagName);
    // Содержимое шторки зависит от данных; поле, в которое печатают, не трогаем
    if (app.ui.sheet && !force && !typing(document.getElementById('sheet'))) renderSheet(app);
    if (!force && app.view?.editor) return; // не сбрасывать форму, пока её заполняют
    if (!force && typing(main)) {
      deferred = true;
      return;
    }
    if (pending && !force) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      const scrollY = window.scrollY;
      app.view.unmount?.(app, main);
      main.innerHTML = app.view.render(app, app.params).toString();
      app.view.mount?.(app, main, app.params);
      if (force) window.scrollTo(0, scrollY);
      for (const a of document.querySelectorAll('nav.tabs a')) {
        a.classList.toggle('on', a.dataset.tab === app.view.tab);
        if (a.dataset.tab === app.view.tab) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
        if (a.dataset.tab === 'trip') a.classList.toggle('live', !!tracker.session);
      }
    });
  }

  function route() {
    const hash = location.hash || '#/home';
    if (app.ui.sheet) closeSheet(app);
    for (const [re, view] of ROUTES) {
      const m = re.exec(hash);
      if (!m) continue;
      app.view?.unmount?.(app, main);
      app.view = view;
      app.params = { ...(m.groups || {}), back: app.history.at(-1) };
      app.history.push(hash);
      view.init?.(app, app.params);
      window.scrollTo(0, 0);
      main.classList.remove('reveal');
      void main.offsetWidth;
      main.classList.add('reveal');
      render(true);
      return;
    }
    app.navigate('#/home');
  }

  const inSheet = (el) => !!el.closest('#sheet');
  const handlerFor = (el, name) => (inSheet(el) ? app.ui.sheet?.actions?.[name] : app.view.actions?.[name]) ?? GLOBAL_ACTIONS[name];

  // ----- события: экран и шторка
  document.addEventListener('click', async (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el || el.tagName === 'FORM' || !(main.contains(el) || inSheet(el))) return;
    const handler = handlerFor(el, el.dataset.action);
    if (!handler) return;
    ev.preventDefault();
    try {
      await handler(app, el, ev);
    } catch (e) {
      haptic('warning');
      toast(e.message);
    }
  });

  document.addEventListener('submit', async (ev) => {
    const form = ev.target.closest('form[data-action]');
    if (!form) return;
    ev.preventDefault();
    try {
      await handlerFor(form, form.dataset.action)?.(app, form, ev);
    } catch (e) {
      toast(e.message);
    }
  });

  // Текстовые поля — на каждый ввод; флажки, списки, даты — только на change
  const onField = (ev) => {
    const el = ev.target.closest('[data-field]');
    if (!el) return;
    const discrete = el.tagName === 'SELECT' || ['checkbox', 'radio', 'date', 'datetime-local', 'time'].includes(el.type);
    if (discrete && ev.type === 'input') return;
    if (el.type === 'range' && ev.type === 'change') return;
    if (inSheet(el)) {
      if (app.ui.sheet?.onInput?.(app, el, ev.type)) renderSheet(app);
      return;
    }
    if (!main.contains(el) || !app.view.onInput) return;
    if (app.view.onInput(app, el, ev.type)) render(true);
  };
  document.addEventListener('input', onField);
  document.addEventListener('change', onField);
  main.addEventListener('focusout', () => {
    if (deferred) setTimeout(() => { deferred = false; render(); }, 0);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && app.ui.sheet) closeSheet(app);
  });

  const GLOBAL_ACTIONS = {
    'dismiss-notice': () => tracker.dismissNotice(),
    'open-trip': () => app.navigate('#/trip'),
    'quick-start': async () => {
      await quickStart(app);
      // дать анимации старта доиграть, затем открыть поездку
      setTimeout(() => app.navigate('#/trip'), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 380);
    },
    'quick-add': () => openQuickAdd(app),
    'sheet-close': () => closeSheet(app, false),
    // Подсказка графика: точечное обновление DOM, без перерисовки (анимации не перезапускаются)
    'chart-tip': (a, el) => {
      const key = `chart:${el.dataset.chart}`;
      const i = +el.dataset.i;
      const sel = a.ui[key] === i ? null : i;
      a.ui[key] = sel;
      haptic();
      const chart = el.closest('.chart');
      const cols = [...chart.querySelectorAll('.col')];
      for (const c of cols) c.setAttribute('aria-pressed', String(+c.dataset.i === sel));
      chart.classList.toggle('dim', sel != null);
      chart.querySelector('.chart-tip')?.remove();
      if (sel == null) return;
      const label = el.getAttribute('aria-label');
      const cut = label.lastIndexOf(': ');
      const tip = document.createElement('div');
      tip.className = 'chart-tip';
      tip.style.left = `${Math.min(84, Math.max(16, ((sel + 0.5) / cols.length) * 100))}%`;
      tip.append(Object.assign(document.createElement('b'), { textContent: label.slice(cut + 2) }),
        Object.assign(document.createElement('small'), { textContent: label.slice(0, cut) }));
      chart.append(tip);
    },
  };

  // ----- подписки
  store.subscribe(() => render());
  tracker.subscribe(() => render());
  sync.subscribe(() => { if (app.view === profileView) render(); });

  // Таймеры поездки обновляются без перерисовки страницы
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
  trackKeyboard();

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
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

boot();
