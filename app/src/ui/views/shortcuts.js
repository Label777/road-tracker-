// Рецепты «Команд» iPhone: готовые ссылки-действия и пошаговая настройка автоматизаций.
import { html } from '../html.js';
import { topBar, group, cell } from '../components.js';
import { HEALTH_SHORTCUT } from '../../core/steps.js';
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

// Команда «Road Tracker шаги»: получает «95|80;40|30» (минуты назад), отдаёт «820;410».
const HEALTH_STEPS = [
  'Откройте «Команды» → «+» и назовите команду ровно: Road Tracker шаги.',
  '«Разделить текст»: «Ввод команды», разделитель «Другой» — точка с запятой ;',
  '«Повторить с каждым» для «Разделённого текста». Дальше — внутри повтора:',
  '— «Разделить текст»: «Повторяемый объект», разделитель «Другой» — вертикальная черта |',
  '— «Получить объект из списка» → «Первый объект»; затем «Скорректировать дату»: «Текущая дата», «Вычесть», [Объект из списка] «минут»; затем «Задать переменную» С.',
  '— «Получить объект из списка» → «Последний объект» из того же «Разделённого текста»; «Скорректировать дату» так же; «Задать переменную» По.',
  '— «Найти образцы Здоровья»: «Шаги», фильтр «Дата начала» — «после» С, «Дата окончания» — «до» По.',
  '— «Вычислить статистику» → «Сумма»; «Округлить число»; «Текст» с этим числом; «Добавить в переменную» Шаги.',
  'После «Конец повтора»: «Объединить текст» — Шаги, разделитель «Другой» ;',
  'Запустите команду один раз — iPhone спросит доступ к «Здоровью», разрешите «Шаги».',
];

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
        ${group('Шаги из «Здоровья» одной кнопкой', html`
          <p class="t-callout" style="padding:var(--s-4) var(--s-4) 0">Сайту доступ к «Здоровью» закрыт — его даёт только iPhone приложениям. Поэтому шаги достаёт команда: сайт передаёт ей время пеших этапов, она возвращает шаги. Настраивается один раз.</p>
          <ol class="recipe">${HEALTH_STEPS.map((x) => html`<li>${x}</li>`)}</ol>
          ${cell({ icon: ICONS.check, title: 'Команда настроена', sub: 'Кнопка «Шаги из «Здоровья»» в поездке и после завершения', toggle: !!app.settings().healthShortcut, field: 'healthShortcut' })}
          <button class="cell" data-action="health-test"><span class="icon">${ICONS.bolt}</span><span class="main"><span>Проверить команду</span><small>Покажет шаги за последний час</small></span></button>
        `, 'Шаги «Здоровья» приходят от iPhone и Apple Watch с задержкой в несколько минут — если только что пришли, подождите немного.')}
        ${STEPS.map((r) => group(r.title, html`<ol class="recipe">${r.steps.map((s) => html`<li>${s}</li>`)}</ol>`))}
      </div>`;
  },
  onInput(app, el) {
    if (el.dataset.field === 'healthShortcut') app.saveSettings({ healthShortcut: el.checked });
    return false;
  },
  actions: {
    'health-test': () => {
      const back = (v) => encodeURIComponent(`${location.origin}${location.pathname}#/do/${v}`);
      location.href = `shortcuts://x-callback-url/run-shortcut?name=${encodeURIComponent(HEALTH_SHORTCUT)}&input=text&text=${encodeURIComponent('60|0')}`
        + `&x-success=${back('health-test')}&x-error=${back('health-error')}&x-cancel=${back('health-cancel')}`;
    },
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
