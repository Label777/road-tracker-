// «Забытая» запись: поездка идёт подозрительно долго — скорее всего, её забыли завершить.
// Предлагаем время окончания по фактам, а не «сейчас»: последняя отметка в пути (пересадка,
// контролёр, точка GPS) и обычная длительность поездки в этом направлении.
import { HOUR, MINUTE, startOfDay, deviceTimeZone } from './time.js';

/**
 * @param {{startedAt:number}} session
 * @param {{now:number, lastActivity?:number|null, usualMs?:number|null, tz?:string}} o
 * @returns {null | {activeFor:number, suggestedEnd:number, basis:'usual'|'activity'|'default'}}
 */
export function staleTrip(session, { now, lastActivity = null, usualMs = null, tz = deviceTimeZone() }) {
  if (!session) return null;
  const age = now - session.startedAt;
  const limit = Math.max(3 * HOUR, usualMs ? 3 * usualMs : 0);
  const overnight = startOfDay(session.startedAt, tz) !== startOfDay(now, tz) && age > 2 * HOUR;
  if (age <= limit && !overnight) return null;

  const activity = Math.max(session.startedAt, lastActivity ?? session.startedAt);
  let suggestedEnd;
  let basis;
  if (usualMs && session.startedAt + usualMs > activity) {
    suggestedEnd = session.startedAt + usualMs;
    basis = 'usual';
  } else if (activity > session.startedAt) {
    suggestedEnd = activity + 5 * MINUTE; // после последней отметки — ещё немного пути
    basis = 'activity';
  } else {
    suggestedEnd = session.startedAt + 45 * MINUTE;
    basis = 'default';
  }
  return { activeFor: age, suggestedEnd: Math.min(now, Math.round(suggestedEnd / MINUTE) * MINUTE), basis };
}
