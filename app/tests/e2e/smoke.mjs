// Сквозная проверка в настоящем Chrome (headless) через DevTools Protocol, без зависимостей.
// Запуск: node tests/e2e/smoke.mjs [путь-к-chrome]   (сайт должен раздаваться на :8080)
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.argv[2] || process.env.CHROME || 'google-chrome';
const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const SHOTS = process.env.SHOTS_DIR || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), 'rt-chrome-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=9333', `--user-data-dir=${profile}`,
  '--window-size=390,844', '--force-device-scale-factor=2', '--lang=ru-RU', 'about:blank',
], { stdio: 'ignore' });

let ws;
let seq = 0;
const pending = new Map();
const errors = [];

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9333/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r) => ws.addEventListener('open', r, { once: true }));
        ws.addEventListener('message', (m) => {
          const msg = JSON.parse(m.data);
          if (msg.id && pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) reject(new Error(msg.error.message));
            else resolve(msg.result);
          } else if (msg.method === 'Runtime.exceptionThrown') {
            errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
          } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
            errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
          }
        });
        return;
      }
    } catch { /* ещё запускается */ }
    await sleep(200);
  }
  throw new Error('Chrome не запустился');
}

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});

async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`${expr}\n→ ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
  return r.result.value;
}

async function waitFor(expr, label, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(`!!(${expr})`)) return;
    await sleep(100);
  }
  throw new Error(`Не дождались: ${label}`);
}

const click = (selector) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) throw new Error('нет элемента ${selector.replace(/'/g, '')}'); el.click(); return true; })()`);
const text = () => evaluate('document.querySelector("main").innerText');
const go = async (hash) => { await evaluate(`location.hash = '${hash}'`); await sleep(250); };
const setField = (selector, value) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) throw new Error('нет поля ${selector.replace(/'/g, '')}');
  el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', {bubbles: true}));
  el.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);

async function shot(name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
}

const checks = [];
function check(cond, label) {
  checks.push(label);
  if (!cond) throw new Error(`ПРОВАЛ: ${label}`);
  console.log(`ok  ${label}`);
}

try {
  await connect();
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTimezoneOverride', { timezoneId: 'Europe/Kyiv' });
  await send('Page.navigate', { url: `${BASE}#/home` });
  await waitFor('document.querySelector(".start-btn")', 'главный экран');
  check((await text()).includes('Начать поездку'), 'главный экран с кнопкой «Начать поездку»');
  await shot('1-home');

  // Быстрый старт → вкладка «Поездка»
  await click('[data-action="quick-start"]');
  await waitFor('location.hash === "#/trip" && document.querySelector("[data-timer]")', 'экран записи');
  check((await text()).includes('Завершить'), 'запись поездки идёт');

  // Этап: маршрутка 720, 20 ₴
  await click('[data-action="open-board"]');
  await waitFor('document.querySelector("form[data-action=board]")', 'форма этапа');
  await evaluate(`document.querySelector('select[name=transport_type]').value = 'minibus'`);
  await evaluate(`document.querySelector('input[name=transport_number]').value = '720'`);
  await evaluate(`document.querySelector('input[name=cost]').value = '20'`);
  await evaluate(`document.querySelector('form[data-action=board] button[type=submit]').click()`);
  await waitFor('document.querySelector("main").innerText.includes("Маршрутка №720")', 'этап добавлен');
  check(true, 'этап «Маршрутка №720» добавлен');

  // Контролёр
  await evaluate(`document.querySelector('details.menu').open = true`);
  await click('[data-action="inspection"][data-value="ticket_checked"]');
  await waitFor('document.querySelector("main").innerText.includes("Билет проверили")', 'отметка контролёра');
  check(true, 'контролёр отмечен на этапе');
  await shot('2-trip');

  // Перезагрузка посреди поездки: запись должна продолжиться
  await send('Page.reload');
  await waitFor('document.querySelector("[data-timer]")', 'восстановление после перезагрузки');
  await go('#/trip');
  check((await text()).includes('Маршрутка №720'), 'после перезагрузки поездка и этапы на месте');

  // Двойное нажатие «Завершить» не ломает данные
  await evaluate(`(() => { const b = document.querySelector('[data-action=finish]'); b.click(); b.click(); })()`);
  await waitFor('!window.roadTracker.tracker.session', 'завершение');
  await go('#/history');
  await waitFor('document.querySelector("main").innerText.includes("20")', 'история');
  const trips = await evaluate('window.roadTracker.store.liveTrips().length');
  check(trips === 1, 'в истории ровно одна поездка');
  const hist = await text();
  check(hist.includes('Пт') || hist.includes('Пн') || hist.includes('Вс'), 'календарь отрисован');
  await shot('3-history');

  // Ручной ввод поездки задним числом
  await go('#/new');
  await waitFor('document.querySelector("[data-field=started_at]")', 'редактор');
  await click('[data-action="seg-add"]');
  await waitFor('document.querySelector("[data-field=\\"seg.0.cost\\"]")', 'этап в редакторе');
  await setField('[data-field="seg.0.transport_type"]', 'metro');
  await setField('[data-field="seg.0.cost"]', '8');
  await setField('[data-field="extra_cost"]', '5,50');
  check((await text()).includes('13,50'), 'итог пересчитывается при вводе (8 + 5,50)');
  await setField('[data-field="comment"]', 'тест');
  await shot('4-editor');
  await click('[data-action="save"]');
  await waitFor('window.roadTracker.store.liveTrips().length === 2', 'сохранение поездки');
  check(true, 'поездка, введённая вручную, сохранена');

  // Неверное время не сохраняется
  await go('#/new');
  await waitFor('document.querySelector("[data-field=finished_at]")', 'редактор');
  const start = await evaluate('document.querySelector("[data-field=started_at]").value');
  await setField('[data-field="finished_at"]', start);
  check((await text()).includes('Окончание должно быть позже начала'), 'ошибка времени показана');
  await click('[data-action="save"]');
  await sleep(300);
  check((await evaluate('window.roadTracker.store.liveTrips().length')) === 2, 'поездка с неверным временем не сохранена');

  // Фильтры
  await go('#/history');
  await click('[data-action="history-mode"][data-value="list"]');
  await click('[data-action="toggle-filters"]');
  await waitFor('document.querySelector("[data-field=transports]")', 'фильтры');
  await evaluate(`(() => { const c = document.querySelector('[data-field=transports][value=metro]'); c.checked = true; c.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  await sleep(200);
  check((await text()).includes('Показано поездок: 1'), 'фильтр по транспорту: 1 поездка с метро');
  await shot('5-filters');

  // Аналитика и калькулятор
  await go('#/analytics');
  await waitFor('document.querySelector("#calc-result")', 'аналитика');
  check((await text()).includes('Минута стоит 0,80'), 'калькулятор экономии: 0,80 ₴ за минуту');
  check((await text()).includes('Недостаточно данных'), 'статистика контролёров честно говорит о малой выборке');
  await shot('6-analytics');

  // Шаблон маршрута и старт по нему
  await go('#/route/new');
  await waitFor('document.querySelector("[data-field=name]")', 'редактор маршрута');
  await setField('[data-field="name"]', 'Утро');
  await setField('[data-field="seg.0.transport_number"]', '720');
  await setField('[data-field="seg.0.cost"]', '20');
  await click('[data-action="save"]');
  await waitFor('location.hash === "#/routes"', 'маршрут сохранён');
  await go('#/trip');
  await click('[data-action="start-template"]');
  await waitFor('document.querySelector("main").innerText.includes("Маршрутка №720")', 'старт по шаблону');
  check(true, 'старт по шаблону открывает первый этап');
  await click('[data-action="finish"]');
  await waitFor('!window.roadTracker.tracker.session', 'завершение');

  // Место
  await go('#/place/new-home');
  await waitFor('document.querySelector("[data-field=latitude]")', 'редактор места');
  await setField('[data-field="latitude"]', '50.45');
  await setField('[data-field="longitude"]', '30.52');
  await click('[data-action="save"]');
  await waitFor('location.hash === "#/places"', 'место сохранено');
  check((await text()).includes('Дом'), 'место «Дом» сохранено');

  // Профиль и очередь синхронизации
  await go('#/profile');
  check((await text()).includes('Облако не подключено') || (await text()).includes('Подключить'), 'профиль: облако не подключено, данные локальные');
  const queue = await evaluate('window.roadTracker.store.queue().length');
  check(queue > 0, `изменения ждут в очереди синхронизации (${queue})`);
  await shot('7-profile');

  // Данные переживают перезагрузку
  await send('Page.reload');
  await waitFor('window.roadTracker?.store', 'перезагрузка');
  check((await evaluate('window.roadTracker.store.liveTrips().length')) === 3, 'после перезагрузки все 3 поездки на месте');

  const relevant = errors.filter((e) => !/Карта недоступна|unpkg|tile\.openstreetmap|ERR_|Failed to load resource/i.test(e));
  check(relevant.length === 0, `нет ошибок JavaScript${relevant.length ? `: ${relevant.join(' | ')}` : ''}`);
  console.log(`\nE2E: ${checks.length} проверок пройдено`);
} catch (e) {
  console.error(e.message);
  if (errors.length) console.error('Ошибки в консоли:', errors);
  await shot('failure').catch(() => {});
  process.exitCode = 1;
} finally {
  ws?.close();
  chrome.kill();
}
