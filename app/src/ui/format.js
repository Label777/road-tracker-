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
/** 640 м / 1,2 км */
export const formatDistance = (m) => (m < 1000 ? `${Math.round(m / 10) * 10}\u00a0м` : `${(m / 1000).toFixed(1).replace('.', ',')}\u00a0км`);
export const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  return b >= 2 && b <= 4 ? few : many;
};
/** «870 шагов»; оценка — со знаком «≈». */
export const formatSteps = (n, source = 'sensor') =>
  `${source === 'sensor' ? '' : '≈'}${n.toLocaleString('ru-RU')}\u00a0${plural(n, 'шаг', 'шага', 'шагов')}`;

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

// Иконки (SVG, currentColor) — единый стиль: контур 2px, скругления.
const svg = (path, size = 22) =>
  raw(`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`);
export const ICONS = {
  home: svg('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>'),
  trip: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7l4 9-4-2-4 2z"/>'),
  history: svg('<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4"/>'),
  analytics: svg('<path d="M4 20V11M10 20V5M16 20v-6M21 20H3"/>'),
  profile: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'),
  play: svg('<path d="M7 4.5l12 7.5-12 7.5z" fill="currentColor"/>', 34),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor"/>'),
  pause: svg('<path d="M8 5v14M16 5v14"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  filter: svg('<path d="M4 6h16M7 12h10M10 18h4"/>'),
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  chevron: svg('<path d="M9 18l6-6-6-6"/>', 18),
  shield: svg('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>', 20),
  pin: svg('<path d="M12 21s-7-6-7-11a7 7 0 0114 0c0 5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>'),
  work: svg('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2M3 13h18"/>'),
  gps: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8"/>', 18),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 18),
  wallet: svg('<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18M16 15h2"/>', 18),
  route: svg('<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h7a3 3 0 000-6H9a3 3 0 010-6h7"/>', 18),
  repeat: svg('<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 014-4h12M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 01-4 4H4"/>'),
  bell: svg('<path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 004 0"/>', 18),
  cloud: svg('<path d="M7 18h10a4 4 0 000-8 6 6 0 00-11.6 1.5A3.5 3.5 0 007 18z"/>', 18),
  download: svg('<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>', 18),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>', 18),
  coin: svg('<circle cx="12" cy="12" r="9"/><path d="M9 9h5a2 2 0 010 4h-4a2 2 0 000 4h5M12 6v2M12 16v2"/>', 18),
  target: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>', 18),
  bolt: svg('<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>'),
  upload: svg('<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>', 18),
  copy: svg('<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 00-2-2H5a2 2 0 00-2 2v9a2 2 0 002 2h3"/>', 18),
  check: svg('<path d="M5 12l5 5 9-10"/>', 18),
  link: svg('<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>', 18),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>', 18),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>', 18),
  logo: raw(`<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect width="24" height="24" rx="7" fill="#2ef07a"/><path d="M8 19L11 5M16 19L13 5" stroke="#04140a" stroke-width="2.2" stroke-linecap="round"/><path d="M12 7.5v2M12 12v2M12 16.5v1.5" stroke="#04140a" stroke-width="1.6" stroke-linecap="round"/></svg>`),
};

/** Иконки видов транспорта (минималистичные, в одном стиле). */
/**
 * Цвет каждого вида транспорта — для иконок, линии маршрута на карте, этапов и графиков.
 * Те же значения — CSS-переменные .tr-<вид> в styles.css (тест следит, чтобы совпадали).
 */
export const TRANSPORT_COLORS = {
  walk: '#a78bfa', bus: '#60a5fa', minibus: '#fb923c', trolleybus: '#22d3ee', tram: '#f472b6', metro: '#ef4444',
  train: '#818cf8', taxi: '#facc15', car: '#94a3b8', bicycle: '#4ade80', scooter: '#2dd4bf', other: '#9ca3af',
};
const trSvg = (type, path, size = 22) =>
  raw(`<svg class="tr-icon tr-${type}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`);

export const TRANSPORT_ICONS = {
  walk: trSvg('walk', '<circle cx="13" cy="4" r="2"/><path d="M10 21l2-6-3-3 1-5 4 3 3 1M9 12l-2 3"/>'),
  bus: trSvg('bus', '<rect x="4" y="3" width="16" height="15" rx="3"/><path d="M4 11h16M8 21v-3M16 21v-3"/><circle cx="8" cy="14.5" r=".5"/><circle cx="16" cy="14.5" r=".5"/>'),
  minibus: trSvg('minibus', '<path d="M3 16V9a3 3 0 013-3h9l5 5v5"/><path d="M3 11h17"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M9 17h6"/>'),
  trolleybus: trSvg('trolleybus', '<path d="M9 2l3 4M15 2l-3 4"/><rect x="4" y="6" width="16" height="12" rx="3"/><path d="M4 12h16M8 21v-3M16 21v-3"/>'),
  tram: trSvg('tram', '<path d="M8 2h8M12 2v4"/><rect x="5" y="6" width="14" height="12" rx="3"/><path d="M5 12h14M8 22l2-4M16 22l-2-4"/>'),
  metro: trSvg('metro', '<path d="M4 19L8 5l4 9 4-9 4 14"/>'),
  train: trSvg('train', '<rect x="5" y="3" width="14" height="14" rx="4"/><path d="M5 10h14M8 21l2-4M16 21l-2-4"/><circle cx="9" cy="13.5" r=".5"/><circle cx="15" cy="13.5" r=".5"/>'),
  taxi: trSvg('taxi', '<path d="M10 4h4l1 3"/><path d="M5 11l2-4h10l2 4"/><rect x="3" y="11" width="18" height="6" rx="2"/><path d="M6 17v2M18 17v2"/>'),
  car: trSvg('car', '<path d="M5 11l2-5h10l2 5"/><rect x="3" y="11" width="18" height="6" rx="2"/><path d="M6 17v2M18 17v2"/><circle cx="7.5" cy="14" r=".5"/><circle cx="16.5" cy="14" r=".5"/>'),
  bicycle: trSvg('bicycle', '<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-8h5l3 8M10 8l3 8M9 5h3"/>'),
  scooter: trSvg('scooter', '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M6 18h9l2-12h3M17 6h-2"/>'),
  other: trSvg('other', '<circle cx="12" cy="12" r="9"/><path d="M8 12h.01M12 12h.01M16 12h.01"/>'),
};
