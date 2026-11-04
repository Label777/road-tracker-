// Действия с поездкой, общие для главной, экрана поездки и ссылок-действий («Команды» iPhone).
import { formatMoney } from '../core/money.js';
import { formatDuration, zonedParts } from '../core/time.js';
import { usualPlan, placeToday, loggedToday } from '../core/usual.js';
import { DIRECTIONS, formatTime } from './format.js';

export const suggestedDirection = (now = Date.now()) => (zonedParts(now).hour < 14 ? 'to_work' : 'to_home');

const gpsMode = (app, gps) => ((gps ?? app.ui.startGps ?? app.settings().gpsByDefault) ? 'gps' : 'manual');

/** Начать запись. routeId — шаблон: первый этап открывается сразу. */
export async function startTrip(app, { direction, routeId = null, gps = null } = {}) {
  if (app.tracker.session) return false;
  const route = routeId ? app.store.data.routes.get(routeId) : null;
  if (routeId && (!route || route.deleted_at)) throw new Error('Шаблон маршрута не найден — возможно, он удалён.');
  await app.tracker.send({ type: 'start', direction: route?.direction ?? direction ?? suggestedDirection(), mode: gpsMode(app, gps) });
  const id = app.tracker.session?.tripId;
  if (id && route) {
    await app.store.updateTrip(id, { route_id: route.id });
    if (route.segments[0]) await app.store.appendLiveSegment(id, route.segments[0], Date.now());
  }
  return true;
}

/** Завершить запись; возвращает сохранённую поездку. */
export async function finishTrip(app) {
  const s = app.tracker.session;
  if (!s) return null;
  app.tracker.dismissNotice();
  await app.tracker.send({ type: 'finish' });
  app.ui.liveMap = null;
  return app.store.trip(s.tripId);
}

export function finishedText(app, trip) {
  if (!trip) return 'Поездка сохранена';
  return `Сохранено: ${formatDuration(app.store.tripActiveMs(trip))} · ${formatMoney(app.store.tripCost(trip))}`;
}

/** План «Обычной поездки» на сегодня (или null, если истории в этом направлении нет). */
export function usualToday(app, direction, now = Date.now()) {
  const trips = app.store.completedSummaries();
  const plan = usualPlan(trips, direction);
  if (!plan) return null;
  return { ...plan, ...placeToday(plan, now), logged: loggedToday(trips, direction, now) };
}

/**
 * Записать обычную поездку одним касанием. Показывает подсказку с «Отменить».
 * @returns {Promise<string|null>} id поездки
 */
export async function recordUsual(app, direction, { now = Date.now(), undo = true } = {}) {
  const u = usualToday(app, direction, now);
  if (!u) throw new Error(`Пока нет поездок «${DIRECTIONS[direction].toLowerCase()}» — запишите первую, и дальше она будет добавляться одним касанием.`);
  const { store } = app;
  const d = store.emptyDraft();
  Object.assign(d, { direction, started_at: u.start, finished_at: u.end, route_id: u.routeId, extra_cost: u.extraCost });
  d.segments = u.segments.map((s) => store.newSegmentDraft({ transport_type: s.transport, transport_number: s.number || '', cost: s.cost }));
  const id = await store.saveTrip(d);
  app.haptic('success');
  const text = `${DIRECTIONS[direction]}: ${formatTime(u.start)}–${formatTime(u.end)} · ${formatMoney(u.cost)}`;
  app.toast(`Записано. ${text}`, undo ? {
    action: 'Отменить',
    run: async () => { await store.deleteTrip(id); app.toast('Запись отменена'); },
  } : {});
  return id;
}
