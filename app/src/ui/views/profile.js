// Профиль и настройки: аккаунт и синхронизация, Дом/Работа, геозоны, GPS, уведомления,
// валюта, экспорт, приватность, установка на iPhone.
import { html } from '../html.js';
import { topBar, group, cell, primaryButton, secondaryButton } from '../components.js';
import { ICONS, PLACE_KINDS, formatDateTime } from '../format.js';
import { sheetHeader } from '../sheet.js';
import { gpsPermission, notificationPermission, isStandalone } from '../permissions.js';

const SYNC_TEXT = {
  local: 'Только в этом браузере', signedOut: 'Нужно войти', offline: 'Нет сети — отправим позже',
  syncing: 'Синхронизация…', idle: 'Синхронизировано', error: 'Ошибка синхронизации',
};
const PERM = { granted: 'разрешено', denied: 'запрещено', prompt: 'не запрошен', default: 'не запрошено', unknown: '—', unsupported: 'недоступно' };

// ------------------------------------------------------------------ шторки

const cloudSetupSheet = {
  label: 'Подключить облако',
  render: () => html`
    ${sheetHeader('Подключить облако')}
    <p class="t-callout muted" style="margin-bottom:var(--s-4)">Бесплатный проект Supabase хранит копию данных и синхронизирует устройства. Инструкция — в README репозитория. Нужен только публичный anon key; секретный ключ не вводите.</p>
    <form data-action="save-config" class="stack">
      <label class="field" style="margin:0"><span>Адрес проекта</span><input name="url" type="url" placeholder="https://xxxx.supabase.co" required autocomplete="off"></label>
      <label class="field" style="margin:0"><span>Anon / publishable key</span><input name="anonKey" required autocomplete="off"></label>
      ${primaryButton('Подключить', { type: 'submit', size: 'lg' })}
    </form>`,
  actions: {
    'save-config': (app, form) => {
      const data = new FormData(form);
      const url = String(data.get('url')).trim().replace(/\/$/, '');
      if (!/^https:\/\/[^/]+$/.test(url)) return app.toast('Адрес должен начинаться с https://');
      localStorage.setItem('rt.config', JSON.stringify({ url, anonKey: String(data.get('anonKey')).trim() }));
      location.reload();
      return undefined;
    },
  },
};

const signInSheet = {
  label: 'Вход',
  render: (app) => html`
    ${sheetHeader('Вход в облако')}
    <p class="t-callout muted" style="margin-bottom:var(--s-4)">Неотправленных изменений: ${app.store.queue().length}. После входа они уйдут в облако.</p>
    <form data-action="sign-in" class="stack">
      <label class="field" style="margin:0"><span>Email</span><input name="email" type="email" autocomplete="email" required autofocus></label>
      <label class="field" style="margin:0"><span>Пароль</span><input name="password" type="password" autocomplete="current-password" minlength="6" required></label>
      <div class="btn-row">
        ${secondaryButton('Регистрация', { type: 'submit', name: 'mode', value: 'signup' })}
        ${primaryButton('Войти', { type: 'submit', name: 'mode', value: 'signin' })}
      </div>
    </form>`,
  actions: {
    'sign-in': async (app, form, event) => {
      const data = new FormData(form);
      const mode = event.submitter?.value ?? 'signin';
      try {
        if (mode === 'signup') {
          const r = await app.client.signUp(data.get('email'), data.get('password'));
          if (r === 'confirm_email') {
            app.toast('Проверьте почту и подтвердите регистрацию, затем войдите.');
            return;
          }
        } else {
          await app.client.signIn(data.get('email'), data.get('password'));
        }
        app.haptic('success');
        app.closeSheet();
        app.sync.request();
        app.rerender();
      } catch (e) {
        app.haptic('warning');
        app.toast(e.message);
      }
    },
  },
};

const currencySheet = {
  label: 'Валюта',
  render: () => html`
    ${sheetHeader('Валюта')}
    <div class="group">${cell({ icon: ICONS.coin, title: 'Украинская гривна', value: '₴ UAH' })}</div>
    <p class="group-footer">Суммы хранятся в копейках, без ошибок округления. Другие валюты можно будет добавить вместе с переводом интерфейса.</p>`,
};

// ------------------------------------------------------------------ экран

export const profileView = {
  tab: 'profile',
  init(app) {
    gpsPermission().then((p) => { app.ui.gpsPermission = p; app.rerender(); });
  },
  render(app) {
    const { client, sync, store } = app;
    const st = sync.status;
    const settings = app.settings();
    const places = store.live('locations');
    const home = places.find((p) => p.kind === 'home');
    const work = places.find((p) => p.kind === 'work');
    const notif = notificationPermission();
    const trips = store.liveTrips().length;

    const account = !client
      ? cell({ icon: ICONS.cloud, title: 'Подключить облако', sub: 'Сейчас данные только в этом браузере', action: 'open-cloud' })
      : !client.user
        ? cell({ icon: ICONS.profile, title: 'Войти', sub: 'Чтобы синхронизировать устройства', action: 'open-signin' })
        : cell({ icon: ICONS.profile, title: client.user.email, sub: `${SYNC_TEXT[st.state]}${st.lastSyncedAt ? ` · ${formatDateTime(st.lastSyncedAt)}` : ''}` });

    return html`
      ${topBar('Профиль', { large: true })}
      <div class="stack-lg reveal">
        ${group('Профиль', html`
          ${account}
          ${client?.user ? html`
            ${cell({ icon: ICONS.repeat, title: 'Синхронизировать', value: st.pending ? `в очереди: ${st.pending}` : '', action: 'sync-now' })}
            ${cell({ icon: ICONS.lock, title: 'Выйти', action: 'sign-out' })}` : ''}
        `, st.state === 'error' ? `Ошибка: ${st.message}` : client ? '' : `Записано поездок: ${trips}. Данные не покидают устройство, пока вы не подключите облако.`)}

        ${group('Места и геозоны', html`
          ${cell({ icon: ICONS.home, title: PLACE_KINDS.home, sub: home ? (home.address || `радиус ${home.radius} м`) : 'Не указан', href: home ? `#/place/${home.id}` : '#/place/new-home' })}
          ${cell({ icon: ICONS.work, title: PLACE_KINDS.work, sub: work ? (work.address || `радиус ${work.radius} м`) : 'Не указана', href: work ? `#/place/${work.id}` : '#/place/new-work' })}
          ${cell({ icon: ICONS.pin, title: 'Все места', value: String(places.length), href: '#/places' })}
          ${cell({ icon: ICONS.route, title: 'Шаблоны маршрутов', value: String(store.live('routes').length), href: '#/routes' })}
          ${cell({ icon: ICONS.target, title: 'Подсказка «вы на месте»', sub: 'Во время поездки с GPS у Дома или Работы', toggle: settings.finishHints, field: 'finishHints' })}
        `, 'Радиус геозоны задаётся в карточке места (100–2000 м). Браузер не видит геозоны в фоне — подсказка работает, пока сайт открыт.')}

        ${group('GPS', html`
          ${cell({ icon: ICONS.gps, title: 'Записывать маршрут по умолчанию', toggle: settings.gpsByDefault, field: 'gpsByDefault' })}
          ${cell({ icon: ICONS.lock, title: 'Доступ к геолокации', value: PERM[app.ui.gpsPermission ?? 'unknown'] })}
        `, app.ui.gpsPermission === 'denied' ? 'Разрешите геолокацию: Настройки iPhone → Safari → Геопозиция.' : 'Координаты пишутся только во время поездки и только пока сайт открыт.')}

        ${group('Уведомления', html`
          ${cell({ icon: ICONS.bell, title: 'Уведомление о прибытии', toggle: settings.notifications && notif === 'granted', field: 'notifications' })}
          ${cell({ icon: ICONS.lock, title: 'Разрешение', value: PERM[notif] })}
        `, notif === 'unsupported' ? 'На iPhone уведомления доступны только сайту, установленному на экран «Домой».' : 'Показывается, если вы свернули сайт во время поездки.')}

        ${group('Данные', html`
          ${cell({ icon: ICONS.coin, title: 'Валюта', value: '₴ гривна', action: 'open-currency' })}
          ${cell({ icon: ICONS.download, title: 'Экспорт в CSV', sub: 'Для Excel и Numbers', action: 'export-csv' })}
          ${cell({ icon: ICONS.download, title: 'Резервная копия (JSON)', sub: 'Все поездки, этапы, места и шаблоны', action: 'export-json' })}
        `)}

        ${group('Приватность', html`
          ${cell({ icon: ICONS.trash, title: 'Удалить историю геолокации', sub: 'Треки и координаты наблюдений', action: 'delete-history', danger: true })}
          ${client?.user ? cell({ icon: ICONS.trash, title: 'Удалить аккаунт и все данные', action: 'delete-account', danger: true }) : ''}
        `, 'Треки хранятся только на устройстве и удаляются через 30 дней. В облако координаты маршрута не отправляются.')}

        ${isStandalone() ? '' : group('Установка', html`
          <div style="padding:var(--s-4)" class="t-callout">
            <ol style="margin:0;padding-left:1.2em;display:grid;gap:6px">
              <li>Откройте сайт в Safari.</li>
              <li>«Поделиться» → «На экран Домой».</li>
              <li>Запускайте с иконки — работает без интернета.</li>
            </ol>
          </div>`)}

        <p class="t-caption center faint">Road Tracker · <a href="#/design" class="accent">дизайн-система</a></p>
      </div>`;
  },
  onInput(app, el) {
    const key = el.dataset.field;
    if (key === 'notifications' && el.checked) {
      if (!globalThis.Notification) {
        el.checked = false;
        app.toast('Установите сайт на экран «Домой», чтобы включить уведомления.');
        return false;
      }
      Notification.requestPermission().then((p) => {
        app.saveSettings({ notifications: p === 'granted' });
        if (p !== 'granted') app.toast('Уведомления не разрешены');
      });
      return false;
    }
    app.haptic();
    app.saveSettings({ [key]: el.checked });
    return false;
  },
  actions: {
    'open-cloud': (app) => app.openSheet(cloudSetupSheet),
    'open-signin': (app) => app.openSheet(signInSheet),
    'open-currency': (app) => app.openSheet(currencySheet),
    'sync-now': (app) => { app.haptic(); return app.sync.request(); },
    'sign-out': async (app) => {
      const pending = app.store.queue().length;
      const ok = await app.confirm({
        title: 'Выйти из аккаунта?',
        text: pending ? `Неотправленных изменений: ${pending}. Они останутся в браузере и уйдут после входа.` : 'Данные останутся в этом браузере.',
        confirm: 'Выйти',
      });
      if (!ok) return;
      await app.client.signOut();
      app.rerender();
    },
    'delete-account': async (app) => {
      const ok = await app.confirm({ title: 'Удалить аккаунт?', text: 'Все поездки будут удалены из облака и из этого браузера. Это необратимо.', confirm: 'Удалить навсегда', danger: true });
      if (!ok) return;
      await app.sync.deleteAccount();
      app.toast('Аккаунт удалён');
      app.rerender();
    },
    'delete-history': async (app) => {
      const ok = await app.confirm({ title: 'Удалить историю геолокации?', text: 'Треки и координаты наблюдений будут удалены. Поездки, расходы и время сохранятся.', confirm: 'Удалить', danger: true });
      if (!ok) return;
      await app.store.deleteLocationHistory();
      if (app.client?.user) await app.client.rpc('delete_my_location_history').catch(() => {});
      app.toast('История геолокации удалена');
    },
    'export-json': (app) => {
      const data = {};
      for (const name of ['locations', 'routes', 'trips', 'trip_segments', 'inspections']) data[name] = app.store.live(name);
      download(`road-tracker-${today()}.json`, JSON.stringify(data, null, 2), 'application/json');
    },
    'export-csv': (app) => {
      const { store } = app;
      const rows = [['Дата', 'Начало', 'Окончание', 'Направление', 'Минут', 'Стоимость, грн', 'Этапы', 'Пересадок', 'Контролёр', 'Комментарий']];
      for (const t of store.liveTrips().filter((x) => x.status === 'completed').reverse()) {
        const s = store.summary(t);
        const d = new Date(t.started_at);
        const fmt = (ms) => new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        rows.push([
          d.toLocaleDateString('ru-RU'), fmt(t.started_at), fmt(t.finished_at), t.direction === 'to_work' ? 'На работу' : t.direction === 'to_home' ? 'Домой' : 'Другое',
          Math.round(s.activeMs / 60000), (store.tripCost(t) / 100).toFixed(2).replace('.', ','),
          store.segmentsOf(t.id).map((x) => `${x.transport_type}${x.transport_number ? ` ${x.transport_number}` : ''}`).join(' > '),
          Math.max(0, s.segments.filter((x) => x.transport !== 'walk').length - 1), s.controllers ? 'да' : '', t.comment || '',
        ]);
      }
      const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
      download(`road-tracker-${today()}.csv`, `﻿${csv}`, 'text/csv');
    },
  },
};

const today = () => new Date().toISOString().slice(0, 10);

function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
