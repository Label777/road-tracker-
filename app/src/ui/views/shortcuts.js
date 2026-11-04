// Рецепты «Команд» iPhone: готовые ссылки-действия и пошаговая настройка автоматизаций.
import { html } from '../html.js';
import { topBar, group } from '../components.js';
import { ICONS } from '../format.js';
import { isStandalone } from '../permissions.js';

const base = () => `${location.origin}${location.pathname}`;
const link = (path) => `${base()}#/do/${path}`;

function links(app) {
  const items = [
    ['toggle', 'Старт или финиш', 'Одна ссылка на всё: начинает поездку, а если запись идёт — завершает. Удобно для NFC-метки у двери.'],
    ['start?dir=to_work', 'Начать: на работу', ''],
    ['start?dir=to_home', 'Начать: домой', ''],
    ['finish', 'Завершить поездку', ''],
    ['usual?dir=both', 'Записать обычные поездки за день', 'Записывает «на работу» и «домой», если их сегодня ещё нет. Для вечерней автоматизации.'],
    ['usual', 'Обычная поездка сейчас', 'Направление — по времени суток.'],
    ['add', 'Добавить вручную', 'Открывает шторку быстрого добавления.'],
  ];
  for (const r of app.store.live('routes')) items.push([`start?route=${r.id}`, `Начать по шаблону «${r.name}»`, '']);
  return items;
}

const STEPS = [
  {
    title: 'Начинать поездку, когда выходите из дома',
    steps: [
      'Откройте «Команды» → вкладка «Автоматизация» → «+».',
      'Выберите «Уход», укажите адрес дома, время — «Любое».',
      'Включите «Запускать сразу» (если пункта нет — iPhone будет спрашивать подтверждение).',
      'Действие «Открыть URL» → вставьте ссылку «Начать: на работу».',
    ],
  },
  {
    title: 'NFC-метка у двери или турникета',
    steps: [
      'Купите любую NFC-метку (NTAG213/215) и приклейте у двери.',
      '«Команды» → «Автоматизация» → «+» → «NFC» → «Сканировать» и поднесите iPhone к метке.',
      'Включите «Запускать сразу».',
      'Действие «Открыть URL» → ссылка «Старт или финиш». Дома метка начинает поездку, на работе — завершает.',
    ],
  },
  {
    title: 'Записывать обычные поездки по расписанию',
    steps: [
      '«Команды» → «Автоматизация» → «+» → «Время суток», например 21:00, по будням.',
      'Включите «Запускать сразу».',
      'Действие «Открыть URL» → ссылка «Записать обычные поездки за день».',
      'Если в этот день вы уже записали поездку сами, повтора не будет.',
    ],
  },
];

export const shortcutsView = {
  tab: 'profile',
  render(app) {
    const standalone = isStandalone();
    const cloud = !!app.client?.user;
    const storageNote = {
      kind: standalone && !cloud ? 'warning' : 'suggest',
      text: cloud
        ? 'Облако подключено: поездки из ссылок попадут и в Safari, и в установленный сайт.'
        : 'Ссылки из «Команд» открываются в Safari, а у сайта на экране «Домой» отдельное хранилище. Чтобы поездки не разделялись, подключите облако в Профиле — или пользуйтесь сайтом в Safari.',
    };
    return html`
      ${topBar('Команды iPhone', { back: '#/profile' })}
      <div class="stack-lg reveal">
        <p class="t-callout muted">«Команды» умеют сами открывать ссылку — по времени, при уходе из дома или по NFC-метке. Ссылка выполняет действие и сразу показывает результат, без касаний в сайте.</p>
        <div class="notice ${storageNote.kind === 'warning' ? 'warning' : ''}" role="note"><div class="body t-callout">${storageNote.text}</div></div>
        ${group('Ссылки', html`${links(app).map(([path, title, sub]) => html`
          <div class="cell link-cell">
            <span class="icon">${ICONS.link}</span>
            <span class="main"><span>${title}</span>${sub ? html`<small class="wrap">${sub}</small>` : ''}<code>#/do/${path.replace(/route=[\w-]+/, 'route=…')}</code></span>
            <button class="icon-btn" data-action="copy-link" data-path="${path}" aria-label="Скопировать ссылку «${title}»">${ICONS.copy}</button>
          </div>`)}`, 'Нажмите на значок, чтобы скопировать ссылку, затем вставьте её в действие «Открыть URL».')}
        ${STEPS.map((r) => group(r.title, html`<ol class="recipe">${r.steps.map((s) => html`<li>${s}</li>`)}</ol>`))}
      </div>`;
  },
  actions: {
    'copy-link': async (app, el) => {
      const url = link(el.dataset.path);
      try {
        await navigator.clipboard.writeText(url);
        app.haptic('success');
        app.toast('Ссылка скопирована');
      } catch {
        app.toast(url);
      }
    },
  },
};
