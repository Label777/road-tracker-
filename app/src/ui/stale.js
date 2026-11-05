// Плашка «Похоже, вы забыли завершить поездку» — на главной, в поездке, истории и аналитике.
// Завершить можно сразу во «вероятное» время или выбрать своё; «Ещё в пути» скрывает плашку на час.
import { html } from './html.js';
import { primaryButton } from './components.js';
import { sheetHeader } from './sheet.js';
import { formatDuration } from '../core/time.js';
import { formatTime, formatDateTime, toInputDateTime, fromInputDateTime } from './format.js';
import { staleInfo, finishTrip, finishedText, lastActivity } from './actions.js';

const BASIS = {
  usual: 'обычная длительность поездки в этом направлении',
  activity: 'последняя отметка в пути',
  default: 'начало поездки',
};

export function staleNotice(app, now = Date.now()) {
  const info = staleInfo(app, now);
  if (!info || (app.store.meta('staleSnoozedUntil') ?? 0) > now) return '';
  const s = app.tracker.session;
  return html`
    <div class="notice warning stale-notice" role="alert">
      <div class="body">
        <div class="t-callout"><b>Похоже, вы забыли завершить поездку.</b> Запись идёт ${formatDuration(info.activeFor)} — с ${formatDateTime(s.startedAt)}. Пока поездка не завершена, её нет в истории и аналитике.</div>
        <div class="actions">
          <button class="btn btn-primary btn-sm" data-action="stale-finish" data-at="${info.suggestedEnd}">Завершить в ${formatTime(info.suggestedEnd)}</button>
          <button class="btn btn-secondary btn-sm" data-action="stale-other">Другое время</button>
          <button class="btn btn-ghost btn-sm" data-action="stale-snooze">Ещё в пути</button>
        </div>
        <p class="t-caption" style="margin-top:6px">${formatTime(info.suggestedEnd)} — ${BASIS[info.basis]}.</p>
      </div>
    </div>`;
}

const staleSheet = {
  label: 'Завершить поездку',
  render(app) {
    const s = app.tracker.session;
    if (!s) return html`${sheetHeader('Поездка уже завершена')}`;
    const info = staleInfo(app);
    const floor = Math.max(s.startedAt, lastActivity(app) ?? s.startedAt);
    return html`
      ${sheetHeader('Когда вы приехали?')}
      <p class="t-callout muted" style="margin-bottom:var(--s-4)">Поездка началась ${formatDateTime(s.startedAt)}${floor > s.startedAt ? `, последняя отметка — ${formatDateTime(floor)}` : ''}.</p>
      <form data-action="stale-save" class="stack">
        <label class="field" style="margin:0"><span>Окончание поездки</span>
          <input type="datetime-local" name="end" value="${toInputDateTime(info?.suggestedEnd ?? Date.now())}" min="${toInputDateTime(floor)}" max="${toInputDateTime(Date.now())}" required></label>
        ${primaryButton('Завершить и сохранить', { type: 'submit' })}
      </form>`;
  },
  actions: {
    'stale-save': async (app, form) => {
      const at = fromInputDateTime(String(new FormData(form).get('end') || ''));
      if (at == null) throw new Error('Укажите дату и время окончания');
      const trip = await finishTrip(app, { at });
      app.closeSheet();
      app.haptic('success');
      app.toast(`${finishedText(app, trip)} — в истории`);
    },
  },
};

/** Действия плашки — подмешиваются в экраны, где она показывается. */
export const STALE_ACTIONS = {
  'stale-finish': async (app, el) => {
    const trip = await finishTrip(app, { at: +el.dataset.at });
    app.haptic('success');
    app.toast(`${finishedText(app, trip)} — в истории`, { action: 'Открыть', run: () => app.navigate(`#/edit/${trip.id}`) });
  },
  'stale-other': (app) => app.openSheet(staleSheet),
  'stale-snooze': async (app) => {
    await app.store.setMeta('staleSnoozedUntil', Date.now() + 60 * 60_000);
    app.toast('Хорошо, напомню через час');
  },
};
