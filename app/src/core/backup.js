// Формат резервной копии: все поездки, этапы, наблюдения, места, шаблоны и настройки.
// Треки GPS не входят — они чувствительные и хранятся только на устройстве.

export const BACKUP_TABLES = ['locations', 'routes', 'trips', 'trip_segments', 'inspections'];
export const BACKUP_FORMAT = 1;
export const BACKUP_REMINDER_DAYS = 7;

/** @param {Record<string, object[]>} tables @param {object} settings */
export function buildBackup(tables, settings, now = Date.now()) {
  return {
    app: 'road-tracker',
    format: BACKUP_FORMAT,
    exportedAt: new Date(now).toISOString(),
    settings,
    ...Object.fromEntries(BACKUP_TABLES.map((t) => [t, tables[t] ?? []])),
  };
}

/**
 * Разобрать и проверить файл копии. Принимает и ранний формат (только таблицы, без «app»).
 * @returns {{tables: Record<string, object[]>, settings: object|null, exportedAt: string|null, counts: Record<string, number>}}
 */
export function parseBackup(text) {
  let data;
  try {
    data = typeof text === 'string' ? JSON.parse(text) : text;
  } catch {
    throw new Error('Это не файл резервной копии Road Tracker (не JSON).');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Это не файл резервной копии Road Tracker.');
  if (data.app && data.app !== 'road-tracker') throw new Error('Файл создан другим приложением.');
  if (data.format > BACKUP_FORMAT) throw new Error('Копия создана более новой версией сайта. Обновите страницу.');
  if (!BACKUP_TABLES.some((t) => Array.isArray(data[t]))) throw new Error('В файле нет поездок, мест или шаблонов.');
  const tables = {};
  const counts = {};
  for (const t of BACKUP_TABLES) {
    const rows = Array.isArray(data[t]) ? data[t] : [];
    for (const r of rows) {
      if (!r || typeof r.id !== 'string' || typeof r.updated_at !== 'number') {
        throw new Error('Файл повреждён: у записи нет идентификатора или времени изменения.');
      }
    }
    if (t === 'trips') {
      for (const r of rows) {
        if (typeof r.started_at !== 'number' || !['to_work', 'to_home', 'other'].includes(r.direction)) {
          throw new Error('Файл повреждён: у поездки нет времени начала или направления.');
        }
      }
    }
    tables[t] = rows;
    counts[t] = rows.filter((r) => !r.deleted_at).length;
  }
  return { tables, settings: data.settings && typeof data.settings === 'object' ? data.settings : null, exportedAt: data.exportedAt ?? null, counts };
}

/** Пора ли напомнить о копии: есть поездки, облако не подключено, копии не было неделю. */
export function backupDue({ trips, lastBackupAt, firstTripAt, cloud, now, days = BACKUP_REMINDER_DAYS }) {
  if (cloud || trips < 3) return false;
  const since = lastBackupAt ?? firstTripAt;
  return since != null && now - since >= days * 86_400_000;
}
