// «Прошлая поездка»: поездка задним числом целиком — этап за этапом, у каждого свой транспорт,
// цена и минуты в пути. Время начала каждого этапа считается само: этапы идут встык от выезда.
import { zonedTime, zonedParts, deviceTimeZone, MINUTE } from './time.js';

/**
 * @param {{y:number,m:number,d:number}} date
 * @param {number} startMinute минута суток выезда
 * @param {{transport_type, transport_number?, cost, minutes}[]} stages
 */
export function buildPastTrip({ date, startMinute, stages, tz = deviceTimeZone(), now = Date.now() }) {
  if (!stages.length) throw new Error('Добавьте хотя бы один этап');
  const bad = stages.findIndex((s) => !(Number.isInteger(s.minutes) && s.minutes >= 1 && s.minutes <= 600));
  if (bad >= 0) throw new Error(`Этап ${bad + 1}: укажите, сколько минут он длился`);
  const negative = stages.findIndex((s) => !(Number.isInteger(s.cost) && s.cost >= 0));
  if (negative >= 0) throw new Error(`Этап ${negative + 1}: цена не может быть отрицательной`);
  const started = zonedTime(date.y, date.m, date.d, Math.floor(startMinute / 60), startMinute % 60, tz);
  let t = started;
  const segments = stages.map((s) => {
    const seg = { transport_type: s.transport_type, transport_number: s.transport_number || null, cost: s.cost, started_at: t, finished_at: t + s.minutes * MINUTE };
    t = seg.finished_at;
    return seg;
  });
  if (t > now) throw new Error('Поездка заканчивается в будущем — проверьте дату, время выезда и минуты этапов');
  return { started_at: started, finished_at: t, segments };
}

/**
 * Этапы готовой поездки как образец: транспорт, номер, цена и минуты каждого этапа.
 * Если у этапов нет своего времени (поездка добавлена без этапов по времени) — длительность
 * поездки делится между этапами поровну.
 */
export function stagesFrom(trip, segments) {
  if (!segments.length) return [];
  const total = Math.max(segments.length, Math.round(((trip.finished_at ?? trip.started_at) - trip.started_at) / MINUTE));
  const timed = segments.every((s) => s.started_at != null && s.finished_at != null && s.finished_at > s.started_at);
  return segments.map((s, i) => ({
    transport_type: s.transport_type,
    transport_number: s.transport_number ?? '',
    cost: s.cost || 0,
    minutes: timed
      ? Math.max(1, Math.round((s.finished_at - s.started_at) / MINUTE))
      : Math.max(1, Math.floor(total / segments.length) + (i < total % segments.length ? 1 : 0)),
  }));
}

/** «ГГГГ-ММ-ДД» ↔ дата; «ЧЧ:ММ» → минута суток. */
export const parseDateInput = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v ?? '');
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
};
export const parseTimeInput = (v) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v ?? '');
  return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null;
};
export const dateInput = (ms, tz = deviceTimeZone()) => {
  const p = zonedParts(ms, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
};
export const timeInput = (minute) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
