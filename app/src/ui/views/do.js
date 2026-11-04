// Ссылки-действия для «Команд» iPhone, NFC-меток и закладок:
//   #/do/start?dir=to_work&route=<id>&gps=1   начать поездку (по шаблону)
//   #/do/finish                                завершить текущую
//   #/do/toggle?dir=auto                       начать, а если запись идёт — завершить (одна метка у двери)
//   #/do/usual?dir=both                        записать обычную поездку (если сегодня её ещё нет)
//   #/do/add                                   открыть быстрое добавление
// После действия адрес заменяется (location.replace) — перезагрузка и «Назад» не повторят его.
import { html } from '../html.js';
import { ICONS, DIRECTIONS } from '../format.js';
import { suggestedDirection, startTrip, finishTrip, finishedText, recordUsual, usualToday } from '../actions.js';

export const VERBS = ['start', 'finish', 'toggle', 'usual', 'add'];
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
