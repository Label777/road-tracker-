// Сквозная проверка в настоящем Chrome (headless): все ключевые сценарии на размере iPhone.
// Запуск: node tests/e2e/smoke.mjs [путь-к-chrome]   (сайт на :8080)
import { launch, sleep } from './cdp.mjs';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  check(await has('Сегодня') && await has('Ещё'), 'главный экран: сводка и дополнительные действия');
  check(await b.evaluate('!!document.querySelector("nav.tabs [data-nav=quick-add]")'), 'в центре меню — «Добавить»');
  await b.screenshot(SHOTS, '1-home');

  // Старт → активная поездка (направление задаём явно — тест не зависит от времени суток)
  await b.click('[data-action="home-direction"][data-value="to_home"]');
  await b.click('[data-action="quick-start"]');
  await b.waitFor('document.querySelector("#sheet .start-modes")', 'шторка «На чём едете?»');
  const modes = await b.evaluate('[...document.querySelectorAll("#sheet .start-mode")].map((e) => e.innerText.trim()).join(",")');
  check(modes === 'Автобус,Маршрутка,Пешком', `при старте выбор: ${modes}`);
  await b.click('#sheet [data-action="pick-mode"][data-value="bus"]');
  check(await b.evaluate('!!document.querySelector("#sheet [data-field=\\"pick.cost\\"]")'), 'для автобуса — поле цены');
  await b.screenshot(SHOTS, '1b-start-sheet');
  await b.click('#sheet [data-action="pick-mode"][data-value="walk"]');
  check(await b.evaluate('!document.querySelector("#sheet [data-field=\\"pick.cost\\"]")'), 'пешком — без цены');
  await b.click('#sheet [data-action="pick-go"]');
  await b.waitFor('location.hash === "#/trip" && document.querySelector(".trip-clock")', 'экран поездки');
  check(await b.evaluate(`(() => { const a = window.roadTracker; const s = a.store.segmentsOf(a.tracker.session.tripId); return s.length === 1 && s[0].transport_type === 'walk' && s[0].cost === 0; })()`), 'поездка началась с выбранным этапом «Пешком»');
  check(await has('Завершить'), 'запись поездки идёт');
  check(await b.evaluate('!!document.querySelector("nav.tabs a.center.live[href=\'#/trip\']")'), 'во время записи центр меню — «Поездка»');

  // Этап через шторку
  // В пути: «Сменили транспорт?» — пешком → маршрутка
  check(await has('Сейчас: Пешком'), 'в пути видно текущий транспорт');
  // Шаги: датчик движения (синтетические события ходьбы ~2 шага/с) и расстояние по треку
  check(await has('Считать шаги датчиком'), 'пешком: предложение считать шаги датчиком');
  await b.click('[data-action="enable-steps"]');
  await b.waitFor('window.roadTracker.steps.segId', 'датчик шагов включён');
  await b.evaluate(`new Promise((done) => {
    let i = 0;
    const id = setInterval(() => {
      const z = 9.81 + 3 * Math.sin(2 * Math.PI * 2 * (i * 20) / 1000);
      dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: { x: 0.1, y: 0.2, z } }));
      if (++i >= 250) { clearInterval(id); done(); }
    }, 20);
  })`);
  const counted = await b.evaluate('window.roadTracker.steps.count');
  check(counted >= 4, `датчик насчитал шаги при ходьбе (${counted})`);
  check((await b.evaluate('document.querySelector("[data-steps-live]")?.textContent')) === String(counted), 'шаги обновляются на экране без перерисовки');
  await b.evaluate(`(async () => {
    const a = window.roadTracker, id = a.tracker.session.tripId, t = a.store.segmentsOf(id)[0].started_at;
    // 5 отрезков по ~11 м за 2 с — скорость пешехода
    await a.store.addTrackPoints(id, [0, 1, 2, 3, 4, 5].map((k) => ({ t: t + 100 + k * 400, lat: 50.45 + k * 0.0001, lon: 30.52, acc: 5 })));
  })()`);
  await b.waitFor('/сейчас · \\d+\\s?м/.test(document.querySelector("main").innerText)', 'расстояние этапа');
  check(true, 'расстояние пешего этапа считается по треку вживую');
  await b.screenshot(SHOTS, '2b-trip-change');
  await b.click('[data-action="change-to"][data-value="minibus"]');
  await b.waitFor('document.querySelector("#sheet [data-field=\\"pick.cost\\"]")', 'шторка пересадки');
  check(await b.evaluate('document.querySelector("#sheet").innerText.includes("Когда пересели")'), 'пересадка: можно указать, когда пересели');
  await b.setField('#sheet [data-field="pick.number"]', '720');
  await b.setField('#sheet [data-field="pick.cost"]', '20');
  await b.click('#sheet [data-action="pick-ago"][data-value="2"]');
  await b.screenshot(SHOTS, '2c-change-sheet');
  await b.click('#sheet [data-action="pick-go"]');
  await b.waitFor('document.querySelector("main").innerText.includes("Маршрутка №720")', 'этап добавлен');
  check(await b.evaluate(`(() => { const a = window.roadTracker; const s = a.store.segmentsOf(a.tracker.session.tripId);
    return s.length === 2 && s[0].finished_at === s[1].started_at && s[1].transport_type === 'minibus' && s[1].cost === 2000; })()`),
    'пересадка: этап «Пешком» закрыт, начался «Маршрутка №720» за 20 ₴');
  const walkSaved = await b.evaluate(`(() => { const a = window.roadTracker; const w = a.store.segmentsOf(a.tracker.session.tripId)[0];
    return { steps: w.steps, d: w.distance_meters, sensor: a.steps.segId }; })()`);
  check(walkSaved.steps === counted && walkSaved.d > 0 && !walkSaved.sensor, `при пересадке шаги и расстояние сохранены в пеший этап, датчик выключен (${JSON.stringify(walkSaved)})`);

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

  // Быстрое добавление из центра меню: «как в прошлый раз» → Сохранить (2 действия)
  await b.go('#/home');
  await b.click('nav.tabs [data-nav="quick-add"]');
  await b.waitFor('document.querySelector("#sheet [data-action=qa-save]")', 'шторка добавления');
  check((await sheetText()).includes('Как в прошлый раз'), 'быстрое добавление подставляет прошлую поездку');
  await b.click('#sheet [data-action="qa-day"][data-value="yesterday"]');
  await b.click('#sheet [data-action="qa-save"]');
  await b.waitFor('window.roadTracker.store.liveTrips().length === 2', 'сохранение быстрой поездки');
  check(true, 'поездка добавлена из шторки за два действия');

  // Автодополнение маршрута в шторке
  await b.click('nav.tabs [data-nav="quick-add"]');
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
  check(await b.evaluate('document.querySelectorAll(".insight").length') >= 1, 'аналитика: выводы словами над графиками');
  check(!(await has('Минута стоит')) && await has('Введите время и цену двух вариантов'), 'калькулятор: без второго маршрута — без выдуманных цифр');
  check((await b.evaluate('document.querySelector("[data-field=aCost]").value')) === '20', 'калькулятор: вариант А — средняя цена вашего маршрута');
  await b.setField('[data-field="bMin"]', '90');
  await b.setField('[data-field="bCost"]', '5');
  check(await has('Минута стоит'), 'калькулятор считает после ввода второго варианта');
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
  await b.go('#/home');
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

  const count = () => b.evaluate('window.roadTracker.store.liveTrips().length');

  // «Обычная поездка» в одно касание + «Отменить»
  await b.go('#/home');
  await b.click('[data-action="home-direction"][data-value="to_home"]');
  await b.waitFor('document.querySelector(".usual-card")', 'карточка обычной поездки');
  await b.screenshot(SHOTS, '7-home-usual');
  const before = await count();
  await b.click('.usual-card');
  await b.waitFor(`window.roadTracker.store.liveTrips().length === ${before + 1}`, 'обычная поездка записана');
  check(await b.evaluate('document.querySelector("#toast").innerText.includes("Отменить")'), 'обычная поездка: одно касание, подсказка с «Отменить»');
  await b.click('#toast .toast-action');
  await b.waitFor(`window.roadTracker.store.liveTrips().length === ${before}`, 'отмена');
  check(true, '«Отменить» удаляет только что записанную поездку');

  // Ссылки-действия для «Команд» iPhone
  await b.go('#/do/toggle?dir=to_home');
  await b.waitFor('window.roadTracker.tracker.session && location.hash === "#/trip"', 'старт по ссылке');
  check(true, 'ссылка #/do/toggle начинает поездку');
  await b.go('#/do/toggle');
  await b.waitFor('!window.roadTracker.tracker.session && location.hash === "#/home"', 'финиш по ссылке');
  check((await count()) === before + 1, 'повторная #/do/toggle завершает и сохраняет поездку');
  // Убираем сегодняшние поездки домой — по расписанию должна дописаться именно она
  await b.evaluate(`(async () => {
    const s = window.roadTracker.store;
    const today = new Date().toDateString();
    for (const t of s.liveTrips()) if (t.direction === 'to_home' && new Date(t.started_at).toDateString() === today) await s.deleteTrip(t.id);
  })()`);
  const missing = await b.evaluate(`(async () => {
    const { usualToday } = await import('./src/ui/actions.js');
    return ['to_work', 'to_home'].filter((d) => { const u = usualToday(window.roadTracker, d); return u && !u.logged; }).length;
  })()`);
  const beforeBoth = await count();
  await b.go('#/do/usual?dir=both');
  await b.waitFor('location.hash === "#/home"', 'обычные поездки по ссылке');
  await sleep(300);
  check(missing >= 1 && (await count()) === beforeBoth + missing, `#/do/usual?dir=both дописывает только недостающие направления (${missing})`);
  await b.go('#/do/usual?dir=both');
  await b.waitFor('location.hash === "#/home"', 'повтор');
  await sleep(300);
  check((await count()) === beforeBoth + missing, 'повторный запуск по расписанию не создаёт дублей');
  await b.go('#/shortcuts');
  check(await has('NFC') && await has('#/do/toggle'), 'страница рецептов «Команд» со ссылками');

  // Бюджет месяца
  await b.go('#/home');
  await b.click('[data-action="open-budget"]');
  await b.waitFor('document.querySelector("#sheet [name=budget]")', 'шторка бюджета');
  await b.setField('#sheet [name="budget"]', '1000');
  await b.click('#sheet button[type=submit]');
  await b.waitFor('/из\\s1\\s000/.test(document.querySelector("main").innerText)', 'бюджет на главной');
  check(await has('осталось'), 'бюджет: сколько осталось на месяц');

  // Календарь — тепловая карта без мелких сумм
  await b.go('#/history');
  await b.click('[data-action="history-mode"][data-value="calendar"]');
  await b.waitFor('document.querySelector(".cal-day.has")', 'календарь');
  check(await b.evaluate('!document.querySelector(".cal-cost") && !!document.querySelector(".cal-day.has[style*=heat]")'), 'календарь: яркость дня вместо мелких цифр');

  // Резервная копия: сохранение и восстановление в пустой браузер
  await b.go('#/profile');
  await b.click('[data-action="backup"]');
  await b.waitFor('document.querySelector("main").innerText.includes("Последняя:")', 'копия сохранена');
  check(true, 'резервная копия: дата последней копии в профиле');
  const backup = await b.evaluate(`(async () => {
    const { buildBackup } = await import('./src/core/backup.js');
    return JSON.stringify(buildBackup(window.roadTracker.store.backupTables(), window.roadTracker.settings()));
  })()`);
  const total = await count();
  await b.evaluate('window.roadTracker.store.clearAll()');
  const file = join(mkdtempSync(join(tmpdir(), 'rt-backup-')), 'road-tracker.json');
  writeFileSync(file, backup);
  const { root } = await b.send('DOM.getDocument');
  const { nodeId } = await b.send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-field=restore]' });
  await b.send('DOM.setFileInputFiles', { files: [file], nodeId });
  await b.waitFor('document.querySelector("#sheet [data-action=sheet-confirm]")', 'подтверждение восстановления');
  check((await sheetText()).includes(`Поездок: ${total}`), 'восстановление: сколько поездок в копии');
  await b.click('#sheet [data-action="sheet-confirm"]');
  await b.waitFor(`window.roadTracker.store.liveTrips().length === ${total}`, 'восстановление');
  check((await b.evaluate('window.roadTracker.settings().budget')) === 100000, 'восстановлены поездки и настройки (бюджет)');

  // Данные переживают перезагрузку
  const queue = await b.evaluate('window.roadTracker.store.queue().length');
  check(queue > 0, `изменения ждут в очереди синхронизации (${queue})`);
  await b.send('Page.reload');
  await b.waitFor('window.roadTracker?.store', 'перезагрузка');
  check((await count()) === total, `после перезагрузки все поездки на месте (${total})`);

  // Без сети: оболочка из кэша service worker
  await b.waitFor('navigator.serviceWorker.controller', 'service worker', 10000);
  await b.go('#/home');
  await b.send('Network.enable');
  await b.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  const t0 = Date.now();
  await b.send('Page.reload');
  await b.waitFor('document.querySelector(".start-orb")', 'запуск без сети');
  const coldMs = Date.now() - t0;
  check(coldMs < 1500, `запуск без сети из кэша: ${coldMs} мс`);
  await b.go('#/place/new-work');
  await b.waitFor('document.querySelector(".leaflet-container")', 'карта без сети');
  check(true, 'карта (Leaflet) загружается без сети');
  await b.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  // Производительность: 2 000 поездок, время построения экранов
  await b.evaluate(`(async () => {
    const T0 = Date.now() - 86_400_000;
    const trips = [], trip_segments = [];
    for (let i = 0; i < 2000; i++) {
      const id = 'perf-' + i, start = T0 - i * 12 * 3_600_000;
      trips.push({ id, direction: i % 2 ? 'to_home' : 'to_work', started_at: start, finished_at: start + 2_700_000, pauses: [], extra_cost: 0, status: 'completed', time_zone: 'Europe/Kyiv', created_at: start, updated_at: start, deleted_at: null });
      trip_segments.push({ id: id + '-a', trip_id: id, position: 0, transport_type: 'minibus', transport_number: '720', cost: 2000, updated_at: start, deleted_at: null });
      trip_segments.push({ id: id + '-b', trip_id: id, position: 1, transport_type: 'metro', cost: 800, updated_at: start, deleted_at: null });
    }
    await window.roadTracker.store.importBackup({ tables: { trips, trip_segments } });
  })()`);
  const timing = await b.evaluate(`(async () => {
    const app = window.roadTracker, out = {};
    for (const hash of ['#/home', '#/history', '#/analytics']) {
      location.hash = hash;
      await new Promise((r) => setTimeout(r, 400));
      app.view.render(app, app.params).toString(); // прогрев
      const t = performance.now();
      for (let i = 0; i < 5; i++) app.view.render(app, app.params).toString();
      out[hash] = +((performance.now() - t) / 5).toFixed(1);
    }
    return out;
  })()`);
  const worst = Math.max(...Object.values(timing));
  console.log('    построение экранов на 2 000 поездках, мс:', JSON.stringify(timing));
  check(worst <= 16, `экраны строятся не дольше кадра на 2 000 поездках (худший: ${worst} мс)`);

  const relevant = b.errors.filter((e) => !/tile\.openstreetmap|ERR_|Failed to load resource/i.test(e));
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
