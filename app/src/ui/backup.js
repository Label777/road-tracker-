// Резервная копия: сохранение в «Файлы» через меню «Поделиться» (на iPhone) или скачиванием,
// и восстановление из файла.
import { buildBackup, parseBackup } from '../core/backup.js';
import { formatDateTime } from './format.js';

const stamp = () => new Date().toISOString().slice(0, 10);

export function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * Сохранить копию. На iPhone открывается меню «Поделиться» → «Сохранить в Файлы» (или iCloud Drive).
 * Вызывается прямо из нажатия: Safari разрешает меню только в ответ на действие пользователя.
 */
export async function saveBackup(app) {
  const json = JSON.stringify(buildBackup(app.store.backupTables(), app.settings()), null, 1);
  const name = `road-tracker-${stamp()}.json`;
  const file = typeof File === 'function' ? new File([json], name, { type: 'application/json' }) : null;
  try {
    if (file && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Road Tracker — резервная копия' });
    } else {
      download(name, json, 'application/json');
    }
  } catch (e) {
    if (e?.name === 'AbortError') return false; // пользователь закрыл меню — копия не сохранена
    download(name, json, 'application/json');
  }
  await app.store.setMeta('lastBackupAt', Date.now());
  app.ui.backupDismissed = true;
  app.haptic('success');
  app.toast('Копия сохранена');
  return true;
}

/** Восстановить из выбранного файла (после подтверждения). */
export async function restoreBackup(app, file) {
  let parsed;
  try {
    parsed = parseBackup(await file.text());
  } catch (e) {
    app.haptic('warning');
    app.toast(e.message);
    return;
  }
  const c = parsed.counts;
  const ok = await app.confirm({
    title: 'Восстановить из копии?',
    text: `${parsed.exportedAt ? `Копия от ${formatDateTime(Date.parse(parsed.exportedAt))}. ` : ''}Поездок: ${c.trips}, мест: ${c.locations}, шаблонов: ${c.routes}. `
      + 'Текущие записи не удаляются; если запись есть и там, и здесь, остаётся более свежая.',
    confirm: 'Восстановить',
  });
  if (!ok) return;
  const r = await app.store.importBackup(parsed);
  app.haptic('success');
  app.toast(r.added || r.updated ? `Восстановлено: новых записей ${r.added}, обновлено ${r.updated}` : 'Всё из копии уже есть здесь');
  app.sync.request();
}
