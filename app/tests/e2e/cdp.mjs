// Мини-клиент Chrome DevTools Protocol для e2e-проверок (без зависимостей).
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ chrome = process.env.CHROME || 'google-chrome', port = 9333 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'rt-chrome-'));
  const proc = spawn(chrome, [
    '--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--lang=ru-RU', '--hide-scrollbars', 'about:blank',
  ], { stdio: 'ignore' });

  let ws;
  for (let i = 0; i < 60 && !ws; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r) => ws.addEventListener('open', r, { once: true }));
      }
    } catch { /* запускается */ }
    if (!ws) await sleep(200);
  }
  if (!ws) throw new Error('Chrome не запустился');

  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry.source === 'security') {
      // Нарушения Content-Security-Policy
      errors.push(`CSP: ${msg.params.entry.text}`);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
    }
  });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

  async function evaluate(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`${expr.slice(0, 120)}\n→ ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  }

  async function waitFor(expr, label, timeout = 6000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await evaluate(`!!(${expr})`)) return;
      await sleep(100);
    }
    throw new Error(`Не дождались: ${label}`);
  }

  async function viewport(width, height, scale = 2) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  }

  async function screenshot(dir, name, { full = false } = {}) {
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full });
    writeFileSync(join(dir, `${name}.png`), Buffer.from(data, 'base64'));
  }

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Log.enable');
  await send('Emulation.setTimezoneOverride', { timezoneId: 'Europe/Kyiv' });

  return {
    send, evaluate, waitFor, viewport, screenshot, errors,
    click: (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) throw new Error('нет элемента: ' + ${JSON.stringify(sel)}); el.click(); return true; })()`),
    text: () => evaluate('document.querySelector("main").innerText'),
    go: async (hash) => { await evaluate(`location.hash = ${JSON.stringify(hash)}`); await sleep(300); },
    setField: (sel, value) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) throw new Error('нет поля: ' + ${JSON.stringify(sel)});
      el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', {bubbles: true}));
      el.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`),
    close: () => { ws.close(); proc.kill(); },
  };
}

/** Тестовые поездки за последние недели (только для профиля тестового браузера). */
export const SEED = `(async () => {
  const s = window.roadTracker.store;
  const DAY = 86400000, MIN = 60000;
  const routeId = await s.saveRoute({ name: 'Утро: 720 + метро', direction: 'to_work',
    segments: [{ transport_type: 'minibus', transport_number: '720', cost: 2000 }, { transport_type: 'metro', cost: 800 }] });
  await s.savePlace({ kind: 'home', name: 'Дом', latitude: 50.4501, longitude: 30.5234, radius: 150 });
  await s.savePlace({ kind: 'work', name: 'Работа', latitude: 50.4265, longitude: 30.5383, radius: 200 });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const outcomes = ['no_controller', 'no_controller', 'present_not_checked', 'ticket_checked', 'no_controller'];
  for (let d = 20; d >= 0; d--) {
    const day = today.getTime() - d * DAY;
    const wd = new Date(day).getDay();
    if (wd === 0 || wd === 6) continue;
    for (const [hour, dir] of [[8, 'to_work'], [18, 'to_home']]) {
      if (d === 0 && dir === 'to_home') continue;
      const start = day + hour * 3600000 + ((d * 7) % 20) * MIN;
      const dur = 38 + ((d * 13) % 17);
      const dr = s.emptyDraft();
      Object.assign(dr, { direction: dir, started_at: start, finished_at: start + dur * MIN, route_id: dir === 'to_work' ? routeId : null });
      const a = s.newSegmentDraft({ transport_type: 'minibus', transport_number: '720', cost: 2000 });
      a.started_at = start; a.finished_at = start + 18 * MIN;
      a.inspection = { id: crypto.randomUUID(), outcome: outcomes[(d + hour) % 5], observed_at: start + 5 * MIN, comment: '' };
      const b = s.newSegmentDraft({ transport_type: d % 3 ? 'metro' : 'bus', transport_number: d % 3 ? '' : '24', cost: d % 3 ? 800 : 1500 });
      b.started_at = start + 22 * MIN; b.finished_at = start + dur * MIN;
      dr.segments = [a, b];
      await s.saveTrip(dr);
    }
  }
  return s.liveTrips().length;
})()`;
