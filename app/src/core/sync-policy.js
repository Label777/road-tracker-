// Политика очереди синхронизации и разрешения конфликтов (совпадает с триггером на сервере).

/** Таблицы и порядок отправки: родители раньше детей, иначе сервер отклонит FK. */
export const ENTITIES = ['locations', 'routes', 'trips', 'trip_segments', 'inspections'];
export const priority = (entity) => ENTITIES.indexOf(entity);

/**
 * Схлопывает операции по (entity, entityId): много правок → одна отправка; удаление поглощает upsert.
 * @typedef {{id: string, entity: string, entityId: string, kind: 'upsert'|'delete',
 *            enqueuedAt: number, attempts: number, nextAttemptAt: number, lastError?: string|null}} Op
 */
export function mergeOp(existing, incoming) {
  if (!existing) return incoming;
  return {
    ...existing,
    kind: existing.kind === 'delete' || incoming.kind === 'delete' ? 'delete' : 'upsert',
    attempts: 0,
    nextAttemptAt: incoming.enqueuedAt,
    lastError: null,
  };
}

/** Готовые к отправке, в безопасном порядке: upsert родитель→ребёнок, delete ребёнок→родитель. */
export function readyOps(ops, now, limit = 50) {
  const due = ops.filter((o) => o.nextAttemptAt <= now);
  const ups = due.filter((o) => o.kind === 'upsert')
    .sort((a, b) => priority(a.entity) - priority(b.entity) || a.enqueuedAt - b.enqueuedAt);
  const dels = due.filter((o) => o.kind === 'delete')
    .sort((a, b) => priority(b.entity) - priority(a.entity) || a.enqueuedAt - b.enqueuedAt);
  return [...ups, ...dels].slice(0, limit);
}

/** Экспоненциальный бэкофф с джиттером: 2, 4, 8… с, не больше 15 минут (мс). */
export function backoffMs(attempt, jitter = Math.random()) {
  const base = Math.min(900, 2 ** Math.min(attempt, 10));
  return base * (0.75 + 0.5 * jitter) * 1000;
}

export function markFailed(op, error, now, jitter = Math.random()) {
  const attempts = op.attempts + 1;
  return { ...op, attempts, lastError: String(error), nextAttemptAt: now + backoffMs(attempts, jitter) };
}

/**
 * Last-write-wins по updated_at; удалённая запись не воскрешается старой правкой.
 * Даты — ISO-строки или мс. Возвращает 'local' | 'remote'.
 */
export function resolveConflict(local, remote) {
  const t = (v) => (v == null ? null : typeof v === 'number' ? v : Date.parse(v));
  const lu = t(local.updated_at), ru = t(remote.updated_at);
  const ld = t(local.deleted_at), rd = t(remote.deleted_at);
  if (rd != null && ld == null && lu <= rd) return 'remote';
  if (ld != null && rd == null && ru <= ld) return 'local';
  return lu >= ru ? 'local' : 'remote';
}
