// Сквозные проверки в WebKit — движке Safari (через Playwright).
// Запуск: node tests/e2e/webkit.mjs        (сайт на :8080; BROWSER=chromium — для проверки самого скрипта)
// В CI: npm i playwright && npx playwright install --with-deps webkit
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const engine = pw[process.env.BROWSER || 'webkit'];

const browser = await engine.launch();
const context = await browser.newContext({
  viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: engine.name() !== 'firefox', hasTouch: true,
  locale: 'ru-RU', timezoneId: 'Europe/Kyiv',
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/tile\.openstreetmap|Failed to load resource/i.test(m.text())) errors.push(m.text()); });

let n = 0;
const check = (cond, label) => {
  if (!cond) throw new Error(`ПРОВАЛ: ${label}`);
  n++;
  console.log(`ok  ${label}`);
};
const count = () => page.evaluate(() => window.roadTracker.store.liveTrips().length);

try {
  await page.goto(`${BASE}#/home`);
  await page.waitForSelector('.start-orb');
  check(true, `${engine.name()}: главная открылась`);

  // Пульт целиком на первом экране iPhone SE
  const fold = await page.evaluate(() => {
    const nav = document.querySelector('nav.tabs').getBoundingClientRect().top;
    return ['.start-orb', '.summary-strip'].every((s) => document.querySelector(s).getBoundingClientRect().bottom <= nav);
  });
  check(fold, 'iPhone SE: старт и расходы сегодня/за месяц видны без прокрутки');

  // Добавление из центра меню
  await page.click('nav.tabs [data-nav="quick-add"]');
  await page.waitForSelector('#sheet [data-action="qa-save"]');
  await page.fill('#sheet [data-field="qa.total"]', '25');
  await page.click('#sheet [data-action="qa-day"][data-value="yesterday"]');
  await page.click('#sheet [data-action="qa-save"]');
  await page.waitForFunction(() => window.roadTracker.store.liveTrips().length === 1);
  check(true, 'поездка добавлена из шторки (IndexedDB в WebKit)');

  // Обычная поездка в одно касание
  const dir = await page.evaluate(() => window.roadTracker.store.liveTrips()[0].direction);
  await page.click(`[data-action="home-direction"][data-value="${dir}"]`);
  await page.waitForSelector('.usual-card');
  await page.click('.usual-card');
  await page.waitForFunction(() => window.roadTracker.store.liveTrips().length === 2);
  check(true, '«Обычная поездка» записана одним касанием');

  // Ссылки-действия
  await page.evaluate(() => { location.hash = '#/do/toggle?dir=to_work'; });
  await page.waitForFunction(() => !!window.roadTracker.tracker.session && location.hash === '#/trip');
  await page.evaluate(() => { location.hash = '#/do/finish'; });
  await page.waitForFunction(() => !window.roadTracker.tracker.session && location.hash === '#/home');
  check((await count()) === 3, 'ссылки #/do/toggle и #/do/finish записывают поездку');

  // Аналитика и выводы
  await page.evaluate(() => { location.hash = '#/analytics'; });
  await page.waitForSelector('#calc-result');
  check(await page.isVisible('text=Деньги против времени'), 'аналитика открылась');

  // Перезагрузка — данные на месте
  await page.reload();
  await page.waitForFunction(() => !!window.roadTracker?.store);
  check((await count()) === 3, 'после перезагрузки поездки на месте');

  // Карта из собственной копии Leaflet
  await page.evaluate(() => { location.hash = '#/place/new-home'; });
  await page.waitForSelector('.leaflet-container');
  check(true, 'карта (Leaflet из сайта) открывается');

  check(errors.length === 0, `нет ошибок JavaScript${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  console.log(`\n${engine.name()}: ${n} проверок пройдено`);
} catch (e) {
  console.error(e.message);
  if (errors.length) console.error('Ошибки:', errors);
  await page.screenshot({ path: 'webkit-failure.png' }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
