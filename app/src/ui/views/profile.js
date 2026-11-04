// Профиль: облако (вход, синхронизация), места и шаблоны, приватность, установка на iPhone.
import { html } from '../html.js';
import { topBar, card } from '../components.js';
import { ICONS, formatDateTime } from '../format.js';

const SYNC_TEXT = {
  local: 'Облако не подключено — данные хранятся только в этом браузере',
  signedOut: 'Войдите, чтобы сохранять данные в облаке',
  offline: 'Нет сети — изменения сохранены и уйдут позже',
  syncing: 'Синхронизация…',
  idle: 'Всё синхронизировано',
  error: 'Ошибка синхронизации',
};

function cloud(app) {
  const { client, sync } = app;
  if (!client) {
    return card('Облако', html`
      <p class="muted small">Чтобы данные не потерялись при очистке Safari и были доступны на других устройствах, подключите бесплатный проект Supabase (инструкция — в README репозитория). Нужны адрес проекта и публичный anon key — секретный ключ сюда не вводите.</p>
      <form class="form" data-action="save-config">
        <label>Адрес проекта<input name="url" type="url" placeholder="https://xxxx.supabase.co" required></label>
        <label>Anon / publishable key<input name="anonKey" required autocomplete="off"></label>
        <button class="btn primary" type="submit">Подключить</button>
      </form>`);
  }
  const st = sync.status;
  if (!client.user) {
    return card('Облако', html`
      <p class="muted small">${SYNC_TEXT.signedOut}. Неотправленных изменений: ${st.pending}.</p>
      <form class="form" data-action="sign-in">
        <label>Email<input name="email" type="email" autocomplete="email" required></label>
        <label>Пароль<input name="password" type="password" autocomplete="current-password" minlength="6" required></label>
        <div class="btn-row">
          <button class="btn" type="submit" name="mode" value="signup">Регистрация</button>
          <button class="btn primary" type="submit" name="mode" value="signin">Войти</button>
        </div>
      </form>
      <button class="link small" data-action="forget-config">Отключить облако</button>`);
  }
  return card('Облако', html`
    <p>${client.user.email}</p>
    <p class="${st.state === 'error' ? 'error' : st.state === 'offline' ? 'warn' : 'muted'} small">
      ${SYNC_TEXT[st.state]}${st.message && st.state === 'error' ? `: ${st.message}` : ''}
      ${st.pending ? ` · в очереди: ${st.pending}` : ''}
      ${st.lastSyncedAt ? ` · ${formatDateTime(st.lastSyncedAt)}` : ''}
    </p>
    <div class="btn-row">
      <button class="btn" data-action="sync-now">Синхронизировать</button>
      <button class="btn" data-action="sign-out">Выйти</button>
    </div>
    <button class="link danger small" data-action="delete-account">Удалить аккаунт и все данные</button>`);
}

export const profileView = {
  tab: 'profile',
  render(app) {
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    return html`
      ${topBar('Профиль')}
      <div class="stack">
        ${cloud(app)}
        ${card('Маршруты', html`<div class="list">
          <a class="row" href="#/places"><span class="row-icon">${ICONS.pin}</span><span class="row-main"><span class="row-title">Места: дом, работа и другие</span></span>${ICONS.chevron}</a>
          <a class="row" href="#/routes"><span class="row-icon">${ICONS.bus}</span><span class="row-main"><span class="row-title">Шаблоны маршрутов</span></span>${ICONS.chevron}</a>
        </div>`)}
        ${standalone ? '' : card('Установить на iPhone', html`
          <ol class="small">
            <li>Откройте этот сайт в Safari.</li>
            <li>Нажмите «Поделиться» → «На экран Домой».</li>
            <li>Запускайте с иконки: откроется без адресной строки и будет работать без интернета.</li>
          </ol>`)}
        ${card('Приватность', html`
          <p class="muted small">Координаты записываются только во время поездки с включённым GPS и не отправляются в облако. Треки удаляются автоматически через 30 дней.</p>
          <div class="btn-row">
            <button class="btn" data-action="export">Скачать мои данные</button>
            <button class="btn danger" data-action="delete-history">Удалить историю геолокации</button>
          </div>`)}
        <p class="muted small center">Road Tracker · данные хранятся в этом браузере${app.client?.user ? ' и в вашем облаке Supabase' : ''}</p>
      </div>`;
  },
  actions: {
    'save-config': (app, form) => {
      const data = new FormData(form);
      const url = String(data.get('url')).trim();
      if (!/^https:\/\/[^/]+$/.test(url.replace(/\/$/, ''))) return app.toast('Адрес должен начинаться с https://');
      localStorage.setItem('rt.config', JSON.stringify({ url, anonKey: String(data.get('anonKey')).trim() }));
      location.reload();
      return undefined;
    },
    'forget-config': () => {
      if (!confirm('Отключить облако? Данные в браузере останутся.')) return;
      localStorage.removeItem('rt.config');
      localStorage.removeItem('rt.session');
      location.reload();
    },
    'sign-in': async (app, form, event) => {
      const data = new FormData(form);
      const mode = event.submitter?.value ?? 'signin';
      try {
        if (mode === 'signup') {
          const r = await app.client.signUp(data.get('email'), data.get('password'));
          if (r === 'confirm_email') app.toast('Проверьте почту и подтвердите регистрацию, затем войдите.');
        } else {
          await app.client.signIn(data.get('email'), data.get('password'));
        }
        app.sync.request();
        app.rerender();
      } catch (e) {
        app.toast(e.message);
      }
    },
    'sign-out': async (app) => {
      if (app.store.queue().length && !confirm('Есть неотправленные изменения. Они останутся в браузере и уйдут после входа. Выйти?')) return;
      await app.client.signOut();
      app.rerender();
    },
    'sync-now': (app) => app.sync.request(),
    'delete-account': async (app) => {
      if (!confirm('Удалить аккаунт и ВСЕ данные в облаке и в этом браузере? Это необратимо.')) return;
      try {
        await app.sync.deleteAccount();
        app.toast('Аккаунт удалён');
        app.rerender();
      } catch (e) {
        app.toast(e.message);
      }
    },
    'delete-history': async (app) => {
      if (!confirm('Удалить все треки и координаты наблюдений? Поездки, расходы и время сохранятся.')) return;
      await app.store.deleteLocationHistory();
      if (app.client?.user) await app.client.rpc('delete_my_location_history').catch(() => {});
      app.toast('История геолокации удалена');
    },
    export: (app) => {
      const data = {};
      for (const name of ['locations', 'routes', 'trips', 'trip_segments', 'inspections']) data[name] = app.store.live(name);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `road-tracker-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
  },
};
