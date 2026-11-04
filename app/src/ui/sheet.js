// Нижняя шторка (Bottom Sheet / ConfirmationSheet). Одна на экран; содержимое —
// объект {label, render(app), actions?, onInput?}. Действия внутри шторки
// обрабатываются тем же делегированием событий, что и экран.
import { html } from './html.js';
import { ICONS } from './format.js';

export function openSheet(app, sheet) {
  app.ui.sheet = sheet;
  renderSheet(app, { fresh: true });
  requestAnimationFrame(() => {
    document.querySelector('#sheet .sheet [autofocus]')?.focus({ preventScroll: true });
  });
}

export function closeSheet(app, result) {
  const current = app.ui.sheet;
  if (!current) return;
  app.ui.sheet = null;
  current.resolve?.(result);
  const el = document.querySelector('#sheet .sheet');
  const root = document.getElementById('sheet');
  if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.innerHTML = '';
    return;
  }
  el.classList.add('closing');
  root.querySelector('.sheet-scrim')?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' });
  setTimeout(() => { if (!app.ui.sheet) root.innerHTML = ''; }, 210);
}

/** Перерисовать содержимое шторки (без повторной анимации появления). */
export function renderSheet(app, { fresh = false } = {}) {
  const root = document.getElementById('sheet');
  const sheet = app.ui.sheet;
  if (!sheet) {
    root.innerHTML = '';
    return;
  }
  const body = sheet.render(app).toString();
  const existing = root.querySelector('.sheet-body');
  if (existing && !fresh) {
    existing.innerHTML = body;
    return;
  }
  root.innerHTML = html`
    <div class="sheet-root">
      <div class="sheet-scrim" data-action="sheet-close"></div>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="${sheet.label}">
        <div class="sheet-handle" aria-hidden="true"></div>
        <div class="sheet-body"></div>
      </div>
    </div>`.toString();
  root.querySelector('.sheet-body').innerHTML = body;
  sheet.mount?.(app, root);
}

/** Подтверждение в виде шторки вместо системного confirm(). */
export function confirmSheet(app, { title, text = '', confirm = 'Подтвердить', danger = false }) {
  return new Promise((resolve) => {
    openSheet(app, {
      label: title,
      resolve,
      render: () => html`
        <h2>${title}</h2>
        ${text ? html`<p class="t-callout muted" style="margin-bottom:var(--s-5)">${text}</p>` : ''}
        <div class="stack">
          <button class="btn btn-lg ${danger ? 'btn-secondary' : 'btn-primary'}" style="${danger ? 'color:var(--danger)' : ''}" data-action="sheet-confirm" autofocus>${confirm}</button>
          <button class="btn btn-lg btn-secondary" data-action="sheet-close">Отмена</button>
        </div>`,
      actions: {
        'sheet-confirm': (a) => closeSheet(a, true),
      },
    });
  });
}

/** Клавиатура iOS перекрывает низ экрана — поднимаем содержимое шторки. */
export function trackKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  const update = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb', `${kb}px`);
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
}

export const sheetHeader = (title, extra = '') => html`
  <div class="row-between" style="margin-bottom:var(--s-4)">
    <h2 style="margin:0">${title}</h2>
    ${extra || html`<button class="icon-btn" data-action="sheet-close" aria-label="Закрыть">${ICONS.close}</button>`}
  </div>`;
