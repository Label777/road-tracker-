// Скриншоты всех экранов на трёх размерах iPhone — для визуального аудита.
// Запуск: SHOTS_DIR=… node tests/e2e/screens.mjs   (сайт на :8080)
import { launch, SEED, sleep } from './cdp.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
const DIR = process.env.SHOTS_DIR || 'screens';
const SIZES = { se: [375, 667], i15: [393, 852], max: [430, 932] };
const ONLY = process.env.SIZES ? process.env.SIZES.split(',') : Object.keys(SIZES);
const SCREENS = (process.env.SCREENS || 'home,home-fold,trip-live,new,history,day,analytics,profile,shortcuts,places,design').split(',');

const b = await launch();
try {
  await b.viewport(...SIZES.i15);
  await b.send('Page.navigate', { url: `${BASE}#/home` });
  await b.waitFor('window.roadTracker?.store', 'загрузка');
  if (!process.env.EMPTY) console.log('поездок:', await b.evaluate(SEED));

  for (const size of ONLY) {
    await b.viewport(...SIZES[size]);
    for (const screen of SCREENS) {
      const hash = {
        home: '#/home', 'home-fold': '#/home', 'trip-live': '#/trip', shortcuts: '#/shortcuts', new: '#/history', history: '#/history',
        day: '#/history', analytics: '#/analytics', profile: '#/profile', places: '#/places', design: '#/design',
      }[screen];
      await b.evaluate('window.roadTracker.ui.sheet && window.roadTracker.closeSheet()');
      await sleep(250);
      await b.go(hash);
      if (screen === 'trip-live' && !(await b.evaluate('!!window.roadTracker.tracker.session'))) {
        await b.evaluate(`window.roadTracker.tracker.send({ type: 'start', direction: 'to_work', mode: 'manual' })`);
        await b.evaluate(`window.roadTracker.store.appendLiveSegment(window.roadTracker.tracker.session.tripId, { transport_type: 'minibus', transport_number: '720', cost: 2000 }, Date.now())`);
        await sleep(300);
      }
      if (screen !== 'trip-live' && (await b.evaluate('!!window.roadTracker.tracker.session'))) {
        await b.evaluate(`window.roadTracker.tracker.send({ type: 'cancel' })`);
        await sleep(300);
        await b.go(hash);
      }
      if (screen === 'new') {
        await b.evaluate(`document.querySelector('nav.tabs [data-nav="quick-add"]')?.click()`);
        await sleep(500);
      }
      if (screen === 'day') {
        await b.evaluate(`document.querySelector('.cal-day.has')?.click()`);
        await sleep(500);
      }
      await sleep(700); // анимации появления
      await b.screenshot(DIR, `${size}-${screen}`, { full: !['new', 'day', 'home-fold'].includes(screen) });
    }
  }
  const errs = b.errors.filter((e) => !/tile\.openstreetmap|Failed to load resource|ERR_/i.test(e));
  if (errs.length) { console.error('Ошибки JS:', errs); process.exitCode = 1; }
  console.log('готово');
} finally {
  b.close();
}
