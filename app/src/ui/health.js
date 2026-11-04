// Шаги из «Здоровья» одной кнопкой: сайт открывает команду «Road Tracker шаги» с интервалами
// пеших этапов, команда возвращается по ссылке #/do/health с результатом (параметр result).
import { healthRanges, healthInput, HEALTH_SHORTCUT } from '../core/steps.js';

/** Можно ли подтянуть шаги для поездки: есть завершённые пешие этапы со временем. */
export const canImportHealth = (store, trip) => trip?.status === 'completed' && healthRanges(store.segmentsOf(trip.id)).length > 0;

export function healthUrl(app, tripId, now = Date.now()) {
  const ranges = healthRanges(app.store.segmentsOf(tripId), now);
  const base = `${location.origin}${location.pathname}`;
  const back = (verb) => encodeURIComponent(`${base}#/do/${verb}?trip=${tripId}`);
  return {
    ranges,
    url: `shortcuts://x-callback-url/run-shortcut?name=${encodeURIComponent(HEALTH_SHORTCUT)}&input=text&text=${encodeURIComponent(healthInput(ranges))}`
      + `&x-success=${back('health')}&x-error=${back('health-error')}&x-cancel=${back('health-cancel')}`,
  };
}

/** Запустить команду. Интервалы запоминаются: ответ сопоставляется с этапами по ним. */
export async function importFromHealth(app, tripId) {
  const { ranges, url } = healthUrl(app, tripId);
  if (!ranges.length) {
    app.toast('В поездке нет пеших этапов со временем начала и конца');
    return;
  }
  // Переход — сразу из нажатия (Safari разрешает открыть другое приложение только так),
  // запись интервалов завершается параллельно
  const saving = app.store.setMeta('healthPending', { tripId, ranges, at: Date.now() });
  location.href = url;
  await saving;
}
