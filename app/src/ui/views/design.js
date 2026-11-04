// Превью дизайн-системы (аналог SwiftUI Preview): токены и компоненты на демонстрационных
// значениях. Экран открывается только по ссылке #/design и не участвует в работе приложения.
import { html } from '../html.js';
import {
  topBar, primaryButton, secondaryButton, segmented, transportSelector, metricCard, metricGrid, expenseCard,
  trackingStatus, chartContainer, emptyState, group, cell, sectionTitle,
} from '../components.js';
import { ICONS, TRANSPORT_ICONS } from '../format.js';

const DEMO = (v) => `${v}`; // демонстрационные значения — только для превью

const swatch = (name, varName) => html`<div style="display:flex;align-items:center;gap:var(--s-3);padding:var(--s-2) 0">
  <span style="width:36px;height:36px;border-radius:10px;background:var(${varName});border:1px solid var(--border-strong)"></span>
  <span><span class="t-sub">${name}</span><br><span class="t-caption">${varName}</span></span></div>`;

export const designView = {
  tab: 'profile',
  render(app) {
    return html`
      ${topBar('Дизайн-система', { back: '#/profile' })}
      <div class="stack-lg">
        <p class="t-caption">Превью компонентов на демонстрационных значениях. Реальные экраны используют только ваши данные.</p>

        <section>${sectionTitle('Цвета')}
          <div class="grid-2">
            ${swatch('Background Primary', '--bg-primary')}${swatch('Background Secondary', '--bg-secondary')}
            ${swatch('Surface Primary', '--surface-primary')}${swatch('Surface Elevated', '--surface-elevated')}
            ${swatch('Accent Green', '--accent')}${swatch('Border', '--border-strong')}
            ${swatch('Text Primary', '--text-primary')}${swatch('Text Secondary', '--text-secondary')}
            ${swatch('Success', '--success')}${swatch('Warning', '--warning')}
            ${swatch('Danger', '--danger')}
          </div>
        </section>

        <section>${sectionTitle('Типографика')}
          <div class="stack">
            <span class="t-display">Display 34</span>
            <span class="t-heading">Heading 22</span>
            <span class="t-sub">Subheading 17</span>
            <span>Body 17 — основной текст. Размеры в rem и следуют системному размеру текста.</span>
            <span class="t-caption">Caption 13</span>
            <span class="t-num-xl">0:42:17</span>
          </div>
        </section>

        <section>${sectionTitle('Отступы — шаг 4pt')}
          <div style="display:flex;align-items:flex-end;gap:var(--s-2)">
            ${[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => html`<span style="width:var(--s-${n});height:var(--s-${n});background:var(--accent-soft);border:1px solid var(--accent);border-radius:3px" title="${n * 4}px"></span>`)}
          </div>
        </section>

        <section>${sectionTitle('Кнопки')}
          <div class="stack">
            ${primaryButton('PrimaryButton', { action: 'noop', size: 'lg', icon: ICONS.play })}
            <div class="btn-row">${secondaryButton('Secondary', { action: 'noop' })}${secondaryButton('Disabled', { action: 'noop', disabled: true })}</div>
          </div>
        </section>

        <section>${sectionTitle('Выбор')}
          <div class="stack">
            ${segmented({ a: 'Неделя', b: 'Месяц', c: 'Год' }, app.ui.demoSeg ?? 'b', { action: 'demo-seg' })}
            ${transportSelector(app.ui.demoTransport ?? 'metro', { action: 'demo-transport' })}
          </div>
        </section>

        <section>${sectionTitle('Статус записи')}
          <div class="chips">${trackingStatus('on', 'Запись · ±8 м')}${trackingStatus('warn', 'Нет сигнала')}${trackingStatus('off', 'GPS запрещён')}${trackingStatus('idle', 'Без GPS')}</div>
        </section>

        <section>${sectionTitle('MetricCard')}
          ${metricGrid(metricCard('В пути', DEMO('47 мин'), { icon: ICONS.clock }), metricCard('Потрачено', DEMO('28 ₴'), { icon: ICONS.wallet, hint: 'подсказка' }))}
        </section>

        <section>${sectionTitle('ExpenseCard')}
          ${expenseCard({ icon: TRANSPORT_ICONS.minibus, label: 'Маршрутка', value: DEMO('400 ₴'), hint: '62 %', share: 0.62 })}
          ${expenseCard({ icon: TRANSPORT_ICONS.metro, label: 'Метро', value: DEMO('160 ₴'), hint: '25 %', share: 0.25 })}
        </section>

        <section>${chartContainer({
          id: 'demo', title: 'ChartContainer', total: DEMO('560 ₴'), subtitle: 'нажмите на столбец',
          points: [3, 5, 4, 0, 6, 2, 7].map((v, i) => ({ label: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'][i], title: `День ${i + 1}`, value: v * 1000 })),
          format: (v) => `${Math.round(v / 100)} ₴`, selected: app.ui['chart:demo'] ?? null,
        })}</section>

        <section>${sectionTitle('EmptyState')}${emptyState({ icon: ICONS.route, title: 'Пусто', text: 'Описание пустого состояния и что сделать дальше.' })}</section>

        <section>${group('Группа настроек', html`
          ${cell({ icon: ICONS.gps, title: 'Переключатель', toggle: app.ui.demoToggle ?? true, field: 'demoToggle' })}
          ${cell({ icon: ICONS.pin, title: 'Ссылка', sub: 'Подзаголовок', href: '#/design' })}
          ${cell({ icon: ICONS.trash, title: 'Опасное действие', action: 'demo-confirm', danger: true })}`,
        'ConfirmationSheet — нажмите «Опасное действие».')}</section>

        <section>${sectionTitle('Загрузка')}
          <div class="stack"><div class="skeleton" style="height:18px;width:60%"></div><div class="skeleton" style="height:72px"></div></div>
        </section>
      </div>`;
  },
  onInput(app, el) {
    app.ui.demoToggle = el.checked;
    return false;
  },
  actions: {
    noop: (app) => app.toast('Кнопка нажата'),
    'demo-seg': (app, el) => { app.ui.demoSeg = el.dataset.value; app.rerender(); },
    'demo-transport': (app, el) => { app.ui.demoTransport = el.dataset.value; app.haptic(); app.rerender(); },
    'demo-confirm': async (app) => {
      const ok = await app.confirm({ title: 'Удалить?', text: 'Пример шторки подтверждения.', confirm: 'Удалить', danger: true });
      app.toast(ok ? 'Подтверждено' : 'Отменено');
    },
  },
};
