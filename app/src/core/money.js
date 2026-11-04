// Деньги в копейках (целые числа): никаких погрешностей плавающей точки в отчётах.

const NBSP = ' ';

/** @param {number} hryvnias @param {number} [kopecks] */
export const uah = (hryvnias, kopecks = 0) => hryvnias * 100 + kopecks;

/**
 * «30 ₴», «30,50 ₴», «1 250 ₴», «−12 ₴». Не зависит от локали устройства.
 * @param {number} minor копейки
 */
export function formatMoney(minor) {
  const negative = minor < 0;
  const abs = Math.abs(Math.round(minor));
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const fracPart = frac === 0 ? '' : ',' + String(frac).padStart(2, '0');
  return (negative ? '−' : '') + grouped + fracPart + NBSP + '₴';
}

/** Для полей ввода: «30», «30,50», пусто для нуля. */
export function moneyToInput(minor) {
  if (!minor) return '';
  const whole = Math.trunc(minor / 100);
  const frac = Math.abs(minor % 100);
  return frac === 0 ? String(whole) : `${whole},${String(frac).padStart(2, '0')}`;
}

/**
 * Разбор ввода: «30», «30,5», «30.50», «1 250,00», «18 ₴». null — некорректно.
 * @param {string} text
 * @returns {number | null} копейки
 */
export function parseMoney(text) {
  const cleaned = String(text).replace(/₴/g, '').replace(/[\s ]/g, '').replace(',', '.');
  if (cleaned === '' || !/^\d*(\.\d{0,2})?$/.test(cleaned) || cleaned === '.') return null;
  const [whole, frac = ''] = cleaned.split('.');
  return Number(whole || '0') * 100 + Number(frac.padEnd(2, '0') || '0');
}

/** Деление с округлением до копейки; null при делении на 0. */
export function divideMoney(minor, divisor) {
  if (!divisor) return null;
  return Math.round(minor / divisor);
}

export const sumMoney = (values) => values.reduce((a, b) => a + b, 0);
