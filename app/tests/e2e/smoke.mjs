// Сквозная проверка в настоящем Chrome (headless): все ключевые сценарии на размере iPhone.
// Запуск: node tests/e2e/smoke.mjs [путь-к-chrome]   (сайт на :8080)
import { launch, sleep } from './cdp.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const SHOTS = process.env.SHOTS_DIR || '';
const b = await launch({ chrome: process.argv[2] || process.env.CHROME || 'google-chrome' });
const checks = [];
function check(cond, label) {
  checks.push(label);
  if (!cond) throw new Error(`ПРОВАЛ: ${label}`);
  console.log(`ok  ${label}`);
}
const has = async (s) => (await b.text()).includes(s);
const sheetText = () => b.evaluate('document.querySelector("#sheet")?.innerText || ""');

try {
  await b.viewport(393, 852);
  await b.send('Page.navigate', { url: `${BASE}#/home` });
  await b.waitFor('document.querySelector(".start-orb")', 'главный экран');
  check(await has('Старт'), 'главный экран: приветствие и кнопка «Старт»');
  check(await has('Сегодня') && await has('Быстрые действия'), 'главный экран: показатели и быстрые действия');
  await b.screenshot(SHOTS, '1-home');

  // Старт → активная поездка
  await b.click('[data-action="quick-start"]');
  await b.waitFor('location.hash === "#/trip" && document.querySelector(".trip-clock")', 'экран поездки');
  check(await has('Завершить'), 'запись поездки идёт');

  // Этап через шторку
  await b.click('[data-action="open-board"]');
  await b.waitFor('document.querySelector("#sheet [data-field=\\"board.cost\\"]")', 'шторка этапа');
  await b.click('#sheet [data-action="board-transport"][data-value="minibus"]');
  await b.setField('#sheet [data-field="board.transport_number"]', '720');
  await b.setField('#sheet [data-field="board.cost"]', '20');
  await b.click('#sheet [data-action="board-save"]');
  await b.waitFor('document.querySelector("main").innerText.includes("Маршрутка №720")', 'этап добавлен');
  check(true, 'этап «Маршрутка №720» добавлен через шторку');

  // Контролёр через шторку
  await b.click('[data-action="open-inspection"]');
  await b.waitFor('document.querySelector("#sheet [data-action=inspection]")', 'шторка контролёра');
  await b.click('#sheet [data-action="inspection"][data-value="ticket_checked"]');
  await b.waitFor('document.querySelector("main").innerText.includes("Билет проверили")', 'отметка контролёра');
  check(true, 'контролёр отмечен на этапе');
  await sleep(300);
  await b.screenshot(SHOTS, '2-trip');

  // Перезагрузка посреди поездки
  await b.send('Page.reload');
  await b.waitFor('window.roadTracker?.tracker?.session', 'восстановление после перезагрузки');
  await b.go('#/trip');
  check(await has('Маршрутка №720'), 'после перезагрузки поездка и этапы на месте');

  // Двойное нажатие «Завершить»
  await b.evaluate(`(() => { const x = document.querySelector('[data-action=finish]'); x.click(); x.click(); })()`);
  await b.waitFor('!window.roadTracker.tracker.session', 'завершение');
  check((await b.evaluate('window.roadTracker.store.liveTrips().length')) === 1, 'двойное «Завершить» — ровно одна поездка');

  // Быстрое добавление: «как в прошлый раз» → Сохранить (2 действия)
  await b.go('#/home');
  await b.click('[data-action="quick-add"]');
  await b.waitFor('document.querySelector("#sheet [data-action=qa-save]")', 'шторка добавления');
  check((await sheetText()).includes('Как в прошлый раз'), 'быстрое добавление подставляет прошлую поездку');
  await b.click('#sheet [data-action="qa-day"][data-value="yesterday"]');
  await b.click('#sheet [data-action="qa-save"]');
  await b.waitFor('window.roadTracker.store.liveTrips().length === 2', 'сохранение быстрой поездки');
  check(true, 'поездка добавлена из шторки за два действия');

  // Автодополнение маршрута в шторке
  await b.click('[data-action="quick-add"]');
  await b.waitFor('document.querySelector("#sheet [data-field=\\"qa.query\\"]")', 'шторка');
  await b.setField('#sheet [data-field="qa.query"]', '72');
  await b.waitFor('document.querySelector("#sheet [data-action=qa-pick]")', 'подсказки маршрута');
  check((await sheetText()).includes('№720'), 'автодополнение находит маршрут №720');
  await b.screenshot(SHOTS, '3-quick-add');
  await b.click('#sheet [data-action="sheet-close"]');
  await sleep(300);

  // Полный редактор
  await b.go('#/new');
  await b.waitFor('document.querySelector("[data-field=started_at]")', 'редактор');
  await b.click('[data-action="seg-add"]');
  await b.waitFor('document.querySelector("[data-field=\\"seg.0.cost\\"]")', 'этап в редакторе');
  await b.setField('[data-field="seg.0.transport_type"]', 'metro');
  await b.setField('[data-field="seg.0.cost"]', '8');
  await b.setField('[data-field="extra_cost"]', '5,50');
  check(await has('13,50'), 'итог пересчитывается при вводе (8 + 5,50)');
  await b.click('[data-action="save"]');
  await b.waitFor('window.roadTracker.store.liveTrips().length === 3', 'сохранение');
  check(true, 'поездка из полного редактора сохранена');

  // Неверное время
  await b.go('#/new');
  await b.waitFor('document.querySelector("[data-field=finished_at]")', 'редактор');
  const start = await b.evaluate('document.querySelector("[data-field=started_at]").value');
  await b.setField('[data-field="finished_at"]', start);
  check(await has('Окончание должно быть позже начала'), 'ошибка времени показана');
  await b.click('[data-action="save"]');
  await sleep(300);
  check((await b.evaluate('window.roadTracker.store.liveTrips().length')) === 3, 'поездка с неверным временем не сохранена');

  // История: календарь → шторка дня
  await b.go('#/history');
  await b.waitFor('document.querySelector(".cal-day.has")', 'календарь');
  await b.click('.cal-day.has');
  await b.waitFor('document.querySelector("#sheet .trip-card")', 'шторка дня');
  check(true, 'выбор дня открывает подробности');
  await b.screenshot(SHOTS, '4-day');
  await b.click('#sheet [data-action="sheet-close"]');
  await sleep(300);

  // Фильтры
  await b.click('[data-action="history-mode"][data-value="list"]');
  await b.click('[data-action="open-filters"]');
  await b.waitFor('document.querySelector("#sheet [data-action=filter-toggle]")', 'фильтры');
  await b.click('#sheet [data-action="filter-toggle"][data-group="transports"][data-value="metro"]');
  await sleep(200);
  check((await sheetText()).includes('Показать: 1'), 'фильтр по транспорту: 1 поездка с метро');
  await b.click('#sheet [data-action="sheet-close"]');
  await sleep(300);
  check(await has('Фильтров: 1'), 'активный фильтр виден в истории');

  // Аналитика
  await b.go('#/analytics');
  await b.waitFor('document.querySelector("#calc-result")', 'аналитика');
  check(await has('Минута стоит 0,80'), 'калькулятор экономии: 0,80 ₴ за минуту');
  check(await has('Недостаточно данных'), 'контролёры: честно о малой выборке');
  await b.click('#expenses .col:not(.zero)');
  check((await b.evaluate('!!document.querySelector("#expenses .chart-tip")')), 'подсказка графика по нажатию');
  await b.screenshot(SHOTS, '5-analytics', { full: true });

  // Шаблон и старт по нему
  await b.go('#/route/new');
  await b.waitFor('document.querySelector("[data-field=name]")', 'редактор маршрута');
  await b.setField('[data-field="name"]', 'Утро');
  await b.setField('[data-field="seg.0.transport_number"]', '720');
  await b.setField('[data-field="seg.0.cost"]', '20');
  await b.click('[data-action="save"]');
  await b.waitFor('location.hash === "#/routes"', 'маршрут сохранён');
  await b.go('#/trip');
  await b.click('[data-action="start-template"]');
  await b.waitFor('document.querySelector("main").innerText.includes("Маршрутка №720")', 'старт по шаблону');
  check(true, 'старт по шаблону открывает первый этап');
  await b.click('[data-action="finish"]');
  await b.waitFor('!window.roadTracker.tracker.session', 'завершение');

  // Место
  await b.go('#/place/new-home');
  await b.waitFor('document.querySelector("[data-field=latitude]")', 'редактор места');
  await b.setField('[data-field="latitude"]', '50.45');
  await b.setField('[data-field="longitude"]', '30.52');
  await b.click('[data-action="save"]');
  await b.waitFor('location.hash === "#/places"', 'место сохранено');
  check(await has('Дом'), 'место «Дом» сохранено');

  // Настройки
  await b.go('#/profile');
  check(await has('Подключить облако'), 'профиль: облако не подключено, данные локальные');
  await b.evaluate(`(() => { const s = document.querySelector('[data-field=gpsByDefault]'); s.checked = true; s.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  await sleep(200);
  check((await b.evaluate('window.roadTracker.settings().gpsByDefault')) === true, 'настройка GPS по умолчанию сохраняется');
  await b.screenshot(SHOTS, '6-profile', { full: true });

  // Шторка подтверждения
  await b.go('#/design');
  await b.click('[data-action="demo-confirm"]');
  await b.waitFor('document.querySelector("#sheet [data-action=sheet-confirm]")', 'шторка подтверждения');
  await b.click('#sheet [data-action="sheet-close"]');
  await sleep(300);
  check(!(await b.evaluate('!!document.querySelector("#sheet .sheet:not(.closing)")')), 'шторка подтверждения закрывается');

  // Данные переживают перезагрузку
  const queue = await b.evaluate('window.roadTracker.store.queue().length');
  check(queue > 0, `изменения ждут в очереди синхронизации (${queue})`);
  await b.send('Page.reload');
  await b.waitFor('window.roadTracker?.store', 'перезагрузка');
  check((await b.evaluate('window.roadTracker.store.liveTrips().length')) === 4, 'после перезагрузки все 4 поездки на месте');

  const relevant = b.errors.filter((e) => !/Карта недоступна|unpkg|tile\.openstreetmap|ERR_|Failed to load resource/i.test(e));
  check(relevant.length === 0, `нет ошибок JavaScript${relevant.length ? `: ${relevant.join(' | ')}` : ''}`);
  console.log(`\nE2E: ${checks.length} проверок пройдено`);
} catch (e) {
  console.error(e.message);
  if (b.errors.length) console.error('Ошибки в консоли:', b.errors);
  await b.screenshot(SHOTS || '.', 'failure').catch(() => {});
  process.exitCode = 1;
} finally {
  b.close();
}
