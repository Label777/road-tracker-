// Машина состояний записи поездки. Чистая и сериализуемая: состояние сохраняется
// в IndexedDB после каждого события, поэтому закрытие вкладки не теряет поездку.
//
// В браузере нет фоновых геозон, поэтому событий geofenceEnter/Exit нет:
// подсказка «Вы у работы — завершить?» формируется по GPS, пока сайт открыт.
import { activeDuration } from './time.js';
import { distance } from './geo.js';

/** @typedef {{start:number,end:number}} Interval */
/**
 * @typedef {{
 *   tripId: string, direction: string, mode: 'manual'|'gps', startedAt: number,
 *   pauses: Interval[], pausedSince: number|null, finishSuggestedAt: number|null
 * }} Session
 */

export const initialState = () => ({ status: 'idle', session: null });

export function sessionActiveMs(session, now) {
  const pauses = session.pausedSince ? [...session.pauses, { start: session.pausedSince, end: now }] : session.pauses;
  return activeDuration(session.startedAt, now, pauses);
}

/**
 * Обработка события. Возвращает новое состояние и список команд для сервисов.
 * @param {{status:'idle'|'recording', session: Session|null}} state
 * @param {{type: string, [k: string]: any}} event
 * @param {() => string} newId
 */
export function reduce(state, event, newId = () => crypto.randomUUID()) {
  const s = state.session;
  switch (event.type) {
    case 'start': {
      if (state.status === 'recording') return { state, effects: [] }; // защита от двойного старта
      const session = {
        tripId: newId(), direction: event.direction, mode: event.mode, startedAt: event.at,
        pauses: [], pausedSince: null, finishSuggestedAt: null,
      };
      return {
        state: { status: 'recording', session },
        effects: [{ type: 'tripStarted', session }, ...(event.mode === 'gps' ? [{ type: 'startGps' }] : [])],
      };
    }
    case 'pause': {
      if (state.status !== 'recording' || s.pausedSince) return { state, effects: [] };
      const session = { ...s, pausedSince: event.at };
      return {
        state: { ...state, session },
        effects: [{ type: 'tripPaused', session }, ...(s.mode === 'gps' ? [{ type: 'stopGps' }] : [])],
      };
    }
    case 'resume': {
      if (state.status !== 'recording' || !s.pausedSince) return { state, effects: [] };
      const pauses = event.at > s.pausedSince ? [...s.pauses, { start: s.pausedSince, end: event.at }] : s.pauses;
      const session = { ...s, pauses, pausedSince: null };
      return {
        state: { ...state, session },
        effects: [{ type: 'tripResumed', session }, ...(s.mode === 'gps' ? [{ type: 'startGps' }] : [])],
      };
    }
    case 'finish': {
      if (state.status !== 'recording') return { state, effects: [] };
      const end = Math.max(event.at, s.startedAt);
      const pauses = s.pausedSince ? [...s.pauses, { start: s.pausedSince, end: Math.max(s.pausedSince, end) }] : s.pauses;
      const session = { ...s, pauses, pausedSince: null };
      return {
        state: initialState(),
        effects: [{ type: 'tripFinished', session, end }, ...(s.mode === 'gps' ? [{ type: 'stopGps' }] : [])],
      };
    }
    case 'cancel': {
      if (state.status !== 'recording') return { state, effects: [] };
      return {
        state: initialState(),
        effects: [{ type: 'tripCancelled', tripId: s.tripId }, ...(s.mode === 'gps' ? [{ type: 'stopGps' }] : [])],
      };
    }
    case 'gpsDenied': {
      // Отказ в геолокации: запись продолжается вручную, поездка не теряется.
      if (state.status !== 'recording' || s.mode !== 'gps') return { state, effects: [] };
      const session = { ...s, mode: 'manual' };
      return { state: { ...state, session }, effects: [{ type: 'stopGps' }, { type: 'degradedToManual', tripId: s.tripId }] };
    }
    case 'position': {
      // Прибытие в известное место (не исходное в первые 5 минут) → предложить завершить.
      if (state.status !== 'recording' || s.finishSuggestedAt || s.pausedSince) return { state, effects: [] };
      const place = (event.places || []).find((p) => distance(event.point, p) <= p.radius);
      if (!place) return { state, effects: [] };
      if (event.at - s.startedAt < 5 * 60_000) return { state, effects: [] };
      const session = { ...s, finishSuggestedAt: event.at };
      return { state: { ...state, session }, effects: [{ type: 'suggestFinish', tripId: s.tripId, place: place.name }] };
    }
    default:
      return { state, effects: [] };
  }
}
