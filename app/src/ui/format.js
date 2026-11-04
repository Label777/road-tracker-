// Подписи и форматирование для интерфейса. Все строки UI собраны здесь —
// отсюда же проще всего добавить украинский и английский.
import { raw } from './html.js';
import { zonedParts, zonedTime, deviceTimeZone } from '../core/time.js';

export const LOCALE = 'ru-RU';

export const DIRECTIONS = { to_work: 'На работу', to_home: 'Домой', other: 'Другое' };
export const TRANSPORT = {
  walk: 'Пешком', bus: 'Автобус', minibus: 'Маршрутка', trolleybus: 'Троллейбус', tram: 'Трамвай',
  metro: 'Метро', train: 'Электричка', taxi: 'Такси', car: 'Авто', bicycle: 'Велосипед', scooter: 'Самокат', other: 'Другое',
};
export const TICKETED = new Set(['bus', 'minibus', 'trolleybus', 'tram', 'metro', 'train']);
export const OUTCOME_LABELS = {
  no_controller: 'Контролёра не было',
  present_not_checked: 'Был, но не проверял',
  ticket_checked: 'Билет проверили',
  checked_at_transfer: 'Проверка на пересадке',
  unknown: 'Неизвестно',
};
export const STATUS = { suggested: 'Не подтверждена', active: 'Идёт запись', paused: 'На паузе', completed: 'Завершена' };
export const RELIABILITY = {
  insufficient: 'Недостаточно данных', low: 'Низкая достоверность', moderate: 'Умеренная достоверность', good: 'Хорошая достоверность',
};
export const PLACE_KINDS = { home: 'Дом', work: 'Работа', other: 'Другое место' };

export const segmentTitle = (s) => (s.transport_number ? `${TRANSPORT[s.transport_type]} №${s.transport_number}` : TRANSPORT[s.transport_type]);

const fmt = (opts) => new Intl.DateTimeFormat(LOCALE, { timeZone: deviceTimeZone(), ...opts });
export const formatTime = (ms) => fmt({ hour: '2-digit', minute: '2-digit' }).format(ms);
export const formatDate = (ms) => fmt({ day: 'numeric', month: 'short' }).format(ms);
export const formatDateTime = (ms) => fmt({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(ms);
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const formatDayLong = (ms) => capitalize(fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(ms));
export const formatMonth = (ms) => capitalize(fmt({ month: 'long', year: 'numeric' }).format(ms)).replace(/\s?г\.$/, '');
/** Живой таймер поездки: «0:07:42». */
export function formatClock(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const pad = (n) => String(n).padStart(2, '0');
  return `${Math.floor(t / 3600)}:${pad(Math.floor(t / 60) % 60)}:${pad(t % 60)}`;
}
export const formatPercent = (x, signed = false) =>
  (signed && x > 0 ? '+' : '') + new Intl.NumberFormat(LOCALE, { style: 'percent', maximumFractionDigits: 0 }).format(x);
export const formatKm = (m) => `${(m / 1000).toFixed(1).replace('.', ',')} км`;

/** Значение для <input type="datetime-local"> в поясе устройства. */
export function toInputDateTime(ms) {
  if (ms == null) return '';
  const p = zonedParts(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

export function fromInputDateTime(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || '');
  return m ? zonedTime(+m[1], +m[2], +m[3], +m[4], +m[5]) : null;
}

export const toInputDate = (ms) => (ms == null ? '' : toInputDateTime(ms).slice(0, 10));
export function fromInputDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  return m ? zonedTime(+m[1], +m[2], +m[3]) : null;
}

// Иконки (SVG, currentColor)
const svg = (path, size = 22) =>
  raw(`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`);
export const ICONS = {
  home: svg('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>'),
  trip: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7l4 9-4-2-4 2z"/>'),
  history: svg('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>'),
  analytics: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  profile: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'),
  play: svg('<path d="M7 4l13 8-13 8z"/>', 26),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
  pause: svg('<path d="M8 5v14M16 5v14"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  filter: svg('<path d="M3 5h18l-7 8v6l-4 2v-8z"/>'),
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  chevron: svg('<path d="M9 18l6-6-6-6"/>', 18),
  shield: svg('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>', 18),
  pin: svg('<path d="M12 21s-7-6-7-11a7 7 0 0114 0c0 5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>'),
  bus: svg('<rect x="4" y="3" width="16" height="15" rx="3"/><path d="M4 11h16M8 21v-3M16 21v-3"/>', 18),
  gps: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8"/>'),
};
