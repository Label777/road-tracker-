// Ссылки-действия для «Команд» iPhone, NFC-меток и закладок:
//   #/do/start?dir=to_work&route=<id>&gps=1   начать поездку (по шаблону)
//   #/do/finish                                завершить текущую
//   #/do/toggle?dir=auto                       начать, а если запись идёт — завершить (одна метка у двери)
//   #/do/usual?dir=both                        записать обычную поездку (если сегодня её ещё нет)
//   #/do/add                                   открыть быстрое добавление
//   #/do/health?trip=<id>&result=820;410       ответ команды «Road Tracker шаги» (шаги из «Здоровья»)
// После действия адрес заменяется (location.replace) — перезагрузка и «Назад» не повторят его.
import { html } from '../html.js';
import { ICONS, DIRECTIONS } from '../format.js';
import { suggestedDirection, startTrip, finishTrip, finishedText, recordUsual, usualToday } from '../actions.js';
import { parseHealthResult } from '../../core/steps.js';
import { formatSteps } from '../format.js';

export const VERBS = ['start', 'finish', 'toggle', 'usual', 'add', 'health', 'health-test', 'health-error', 'health-cancel'];
const DIRS = ['to_work', 'to_home', 'other'];

function direction(q) {
  const d = q.get('dir');
  return DIRS.includes(d) ? d : suggestedDirection();
}
const flag = (q, k) => (q.has(k) ? q.get(k) === '1' || q.get(k) === 'true' : null);

async function usual(app, q) {
  const force = flag(q, 'force') === true;
  const dirs = q.get('dir') === 'both' ? ['to_work', 'to_home'] : [direction(q)];
  const done = [];
  const skipped = [];
  for (const dir of dirs) {
    const u = usualToday(app, dir);
    if (!u) { skipped.push(`${DIRECTIONS[dir]}: нет истории`); continue; }
    if (u.logged && !force) { skipped.push(`${DIRECTIONS[dir]}: уже есть`); continue; }
    await recordUsual(app, dir, { undo: dirs.length === 1 });
    done.push(DIRECTIONS[dir]);
  }
  if (!done.length) app.toast(`Ничего не записано — ${skipped.join(', ').toLowerCase()}`);
  else if (dirs.length > 1) app.toast(`Записано: ${done.join(' и ').toLowerCase()}${skipped.length ? ` (${skipped.join(', ').toLowerCase()})` : ''}`);
}

/** Ответ команды «Здоровья»: шаги по интервалам, запомненным при запуске. */
async function health(app, q) {
  const pending = app.store.meta('healthPending');
  const tripId = q.get('trip') ?? pending?.tripId;
  if (!pending || pending.tripId !== tripId) throw new Error('Не нашёл, для какой поездки запрашивались шаги. Нажмите кнопку ещё раз.');
  // result обычно в хеше; если «Команды» вставили его в обычную часть адреса — берём оттуда
  const result = q.get('result') ?? new URLSearchParams(location.search).get('result');
  const steps = parseHealthResult(result, pending.ranges);
  const total = [...steps.values()].reduce((a, b) => a + b, 0);
  await app.store.setMeta('healthPending', null);
  if (!total) {
    app.toast('В «Здоровье» нет шагов за время пеших этапов. Проверьте, что iPhone или часы считают шаги.');
    return `#/edit/${tripId}`;
  }
  for (const [id, n] of steps) await app.store.setSegmentSteps(id, n);
  app.haptic('success');
  app.toast(`Из «Здоровья»: ${formatSteps(total)}`);
  return `#/edit/${tripId}`;
}

export async function runAction(app, verb, query = '') {
  const q = new URLSearchParams(query);
  switch (verb) {
    case 'start':
    case 'toggle': {
      if (app.tracker.session) {
        if (verb === 'toggle') {
          const trip = await finishTrip(app);
          app.haptic('success');
          app.toast(finishedText(app, trip));
          return '#/home';
        }
        app.toast('Поездка уже записывается');
        return '#/trip';
      }
      await startTrip(app, { direction: direction(q), routeId: q.get('route'), gps: flag(q, 'gps') });
      app.haptic('success');
      app.toast(`Поездка началась: ${DIRECTIONS[app.store.trip(app.tracker.session.tripId)?.direction ?? direction(q)].toLowerCase()}`);
      return '#/trip';
    }
    case 'finish': {
      if (!app.tracker.session) { app.toast('Сейчас ничего не записывается'); return '#/home'; }
      const trip = await finishTrip(app);
      app.haptic('success');
      app.toast(finishedText(app, trip));
      return '#/home';
    }
    case 'usual':
      await usual(app, q);
      return '#/home';
    case 'health':
      return health(app, q);
    case 'health-test': {
      const result = q.get('result') ?? new URLSearchParams(location.search).get('result');
      const n = parseHealthResult(result, [{ id: 'test' }]).get('test');
      await app.saveSettings({ healthShortcut: true });
      app.haptic('success');
      app.toast(`Команда работает: за последний час ${formatSteps(n)}`);
      return '#/shortcuts';
    }
    case 'health-error':
      app.toast(`Команда «Здоровья» не сработала: ${q.get('errorMessage') || 'неизвестная ошибка'}`);
      return q.get('trip') ? `#/edit/${q.get('trip')}` : '#/home';
    case 'health-cancel':
      app.toast('Команда отменена — шаги не загружены');
      return q.get('trip') ? `#/edit/${q.get('trip')}` : '#/home';
    case 'add':
      setTimeout(() => app.quickAdd({ direction: DIRS.includes(q.get('dir')) ? q.get('dir') : undefined }), 0);
      return '#/home';
    default:
      app.toast('Неизвестное действие в ссылке');
      return '#/home';
  }
}

export const doView = {
  tab: null,
  init(app, params) {
    // Выполняем после первой отрисовки: пользователь видит, что ссылка сработала.
    setTimeout(async () => {
      let next = '#/home';
      try {
        next = await runAction(app, params.verb, params.query ?? '');
      } catch (e) {
        app.haptic('warning');
        app.toast(e.message);
      }
      location.replace(next);
    }, 0);
  },
  render: () => html`<div class="empty-state"><span class="art">${ICONS.bolt}</span><strong class="t-sub">Выполняю действие…</strong></div>`,
};
