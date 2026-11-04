// Статистика контролёров. Описание прошлого опыта, а не прогноз: рядом с каждой
// долей — размер выборки, 95 % интервал Уилсона и уровень достоверности.
import { zonedParts, deviceTimeZone } from './time.js';

export const OUTCOMES = ['no_controller', 'present_not_checked', 'ticket_checked', 'checked_at_transfer', 'unknown'];

/** true / false / null (неизвестно) */
export function controllerPresent(outcome) {
  if (outcome === 'no_controller') return false;
  if (outcome === 'unknown') return null;
  return true;
}

export function ticketChecked(outcome) {
  if (outcome === 'ticket_checked' || outcome === 'checked_at_transfer') return true;
  if (outcome === 'unknown') return null;
  return false;
}

/** 'insufficient' (<10) | 'low' (<30) | 'moderate' (<100) | 'good' */
export function reliability(n) {
  if (n < 10) return 'insufficient';
  if (n < 30) return 'low';
  if (n < 100) return 'moderate';
  return 'good';
}

/** 95 % интервал Уилсона: корректен при малых n (0 из 5 → [0; 43 %], а не [0; 0]). */
export function wilson(successes, trials, z = 1.959964) {
  if (!trials) return null;
  const n = trials;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

export function proportion(successes, trials) {
  return {
    successes, trials,
    estimate: trials ? successes / trials : null,
    interval: wilson(successes, trials),
    reliability: reliability(trials),
  };
}

/**
 * @param {{outcome: string, observedAt: number, transport?: string, route?: string}[]} observations
 */
export function inspectionStats(observations, tz = deviceTimeZone()) {
  const known = observations.filter((o) => o.outcome !== 'unknown');
  const encounters = observations.filter((o) => controllerPresent(o.outcome) === true).length;
  const checks = observations.filter((o) => ticketChecked(o.outcome) === true).length;
  const counts = {};
  for (const o of observations) counts[o.outcome] = (counts[o.outcome] || 0) + 1;

  const groupBy = (key) => {
    const groups = new Map();
    for (const o of known) {
      const k = key(o);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(o);
    }
    const out = new Map();
    for (const [k, list] of groups) {
      out.set(k, proportion(list.filter((o) => ticketChecked(o.outcome) === true).length, list.length));
    }
    return out;
  };

  return {
    total: observations.length,
    known: known.length,
    encounters,
    checks,
    counts,
    encounterRate: proportion(encounters, known.length),
    checkRate: proportion(checks, known.length),
    byHour: groupBy((o) => zonedParts(o.observedAt, tz).hour),
    byRoute: groupBy((o) => o.route || '—'),
    byTransport: groupBy((o) => o.transport || 'other'),
  };
}
