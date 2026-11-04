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
import { doView } from './views/do.js';
import { shortcutsView } from './views/shortcuts.js';
import { StepSensor } from './step-sensor.js';

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
  [/^#\/shortcuts$/, shortcutsView],
  [/^#\/do\/(?<verb>\w+)(?:\?(?<query>.*))?$/, doView],
];

// Пять вкладок; в центре — «Добавить» (шторка быстрого добавления), а во время записи — «Поездка».
const TABS = [
  ['home', '#/home', 'Главная', ICONS.home],
  ['history', '#/history', 'История', ICONS.history],
  null,
  ['analytics', '#/analytics', 'Аналитика', ICONS.analytics],
  ['profile', '#/profile', 'Профиль', ICONS.profile],
];

function tabsHtml(live) {
  return TABS.map((t) => {
    if (t) return `<a href="${t[1]}" data-tab="${t[0]}">${t[3]}<span>${t[2]}</span></a>`;
    return live
      ? `<a href="#/trip" data-tab="trip" class="center live">${ICONS.trip}<span>Поездка</span></a>`
      : `<button type="button" class="center" data-nav="quick-add" aria-label="Добавить поездку">${ICONS.plus}<span>Добавить</span></button>`;
  }).join('');
}

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
  const store = new Store(new IdbBackend('road-tracker', {
    onVersionChange: () => toast('Сайт обновился в другой вкладке', { action: 'Перезагрузить', run: () => location.reload(), duration: Infinity }),
  }));
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
    settings: () => ({ gpsByDefault: false, finishHints: true, notifications: false, stepSensor: false, heightCm: null, ...store.meta('settings', {}) }),
    saveSettings: (patch) => store.setMeta('settings', { ...app.settings(), ...patch }),
    confirm: (opts) => confirmSheet(app, opts),
    openSheet: (sheet) => openSheet(app, sheet),
    closeSheet: (result) => closeSheet(app, result),
    renderSheet: () => renderSheet(app),
    quickAdd: (opts) => openQuickAdd(app, opts),
  };
  window.roadTracker = app; // для отладки и e2e-тестов
  app.steps = new StepSensor(app);

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
      renderTabs();
    });
  }

  const nav = document.querySelector('nav.tabs');
  let navLive = null;
  function renderTabs() {
    const live = !!tracker.session;
    if (live !== navLive) {
      nav.innerHTML = tabsHtml(live);
      navLive = live;
    }
    for (const a of nav.querySelectorAll('a')) {
      const on = a.dataset.tab === app.view?.tab;
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  }
  nav.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-nav="quick-add"]')) {
      haptic();
      openQuickAdd(app);
    }
  });

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
    'quick-start': () => quickStart(app),
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
  store.subscribe(() => { app.steps.sync(); render(); });
  tracker.subscribe(() => { app.steps.sync(); render(); });
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
    if (document.visibilityState === 'hidden') {
      tracker.flush();
      app.steps.save();
    }
    else {
      tracker.onVisible();
      sync.request();
      render();
    }
  });
  window.addEventListener('pagehide', () => tracker.flush());
  trackKeyboard();

  route();
  store.purgeTrackPoints(30).catch(() => {});
  sync.request();

  registerServiceWorker();
}

/** Офлайн-кэш и обновление: новая версия скачивается в фоне, страница предлагает перейти на неё. */
function registerServiceWorker() {
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || local)) return;
  let updating = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (updating) location.reload(); // только по нажатию «Обновить», не при первой установке
  });
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const offer = (worker) => {
      if (!navigator.serviceWorker.controller) return;
      toast('Доступна новая версия сайта', {
        action: 'Обновить',
        duration: Infinity,
        run: () => { updating = true; worker.postMessage({ type: 'skip-waiting' }); },
      });
    };
    if (reg.waiting) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed') offer(w); });
    });
    // Установленный сайт может жить днями — проверяем обновление при каждом возвращении
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch(() => {});
}

let toastTimer;
let toastRun = null;
/**
 * Короткое сообщение внизу экрана; с action — с кнопкой (например, «Отменить»).
 * @param {string} message @param {{action?: string, run?: () => any, duration?: number}} [opts]
 */
function toast(message, { action = null, run = null, duration } = {}) {
  const el = document.getElementById('toast');
  const text = document.createElement('span');
  text.textContent = message;
  el.replaceChildren(text);
  toastRun = action ? run : null;
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = action;
    el.append(btn);
  }
  el.classList.toggle('actionable', !!action);
  el.classList.add('show');
  clearTimeout(toastTimer);
  const ms = duration ?? (action ? 6000 : 3200);
  if (Number.isFinite(ms)) toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

document.getElementById('toast').addEventListener('click', async (ev) => {
  if (!ev.target.closest('.toast-action') || !toastRun) return;
  const run = toastRun;
  toastRun = null;
  document.getElementById('toast').classList.remove('show');
  try { await run(); } catch (e) { toast(e.message); }
});

boot();
