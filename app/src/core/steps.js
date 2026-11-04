// Шаги на этапах «Пешком».
// Источники по точности: датчик движения телефона (настоящие шаги, пока сайт открыт) →
// расстояние по GPS, делённое на длину шага (от роста) → время ходьбы × средний темп.
// Оценки помечаются в интерфейсе знаком «≈» с пояснением, откуда они.

export const DEFAULT_STRIDE_M = 0.72; // средняя длина шага взрослого
export const WALK_CADENCE = 100; // шагов в минуту — обычный городской темп

/** Длина шага по росту: ≈ 0,415 × рост (общепринятая формула для ходьбы). */
export const strideFromHeight = (cm) => (cm >= 120 && cm <= 230 ? Math.round(cm * 0.415) / 100 : DEFAULT_STRIDE_M);

/**
 * @returns {null | {steps: number, source: 'sensor'|'distance'|'time'}}
 */
export function segmentSteps(seg, { stride = DEFAULT_STRIDE_M, now = Date.now(), distance = null } = {}) {
  if (seg.transport_type !== 'walk') return null;
  if (seg.steps != null) return { steps: seg.steps, source: 'sensor' };
  const meters = distance ?? seg.distance_meters;
  if (meters > 0) return { steps: Math.round(meters / stride), source: 'distance' };
  const end = seg.finished_at ?? now;
  if (seg.started_at != null && end > seg.started_at) {
    return { steps: Math.round(((end - seg.started_at) / 60_000) * WALK_CADENCE), source: 'time' };
  }
  return null;
}

/** Итог по поездке: сумма шагов этапов «Пешком»; источник — наименее точный из использованных. */
export function tripSteps(segments, opts = {}) {
  const rank = { sensor: 0, distance: 1, time: 2 };
  let steps = 0;
  let source = null;
  for (const seg of segments) {
    const r = segmentSteps(seg, { ...opts, distance: opts.distances?.get(seg.id) ?? null });
    if (!r) continue;
    steps += r.steps;
    if (!source || rank[r.source] > rank[source]) source = r.source;
  }
  return source ? { steps, source } : null;
}

export const STEP_SOURCE = {
  sensor: 'по датчику телефона или из «Здоровья»',
  distance: 'по расстоянию GPS и длине шага',
  time: 'по времени ходьбы, ≈100 шагов в минуту',
};

/**
 * Счётчик шагов по акселерометру (DeviceMotion): сглаживание, порог над скользящим средним,
 * интервал между шагами 0,25–2 с. Шаги засчитываются сериями от 4 подряд — тряска в
 * транспорте и одиночные толчки не считаются.
 */
export function createStepDetector({ minInterval = 250, maxInterval = 2000, threshold = 1.2, warmup = 4 } = {}) {
  let smooth = null;
  let mean = 9.81;
  let above = false;
  let lastStep = null;
  let streak = 0;
  return {
    /** @returns {number} сколько шагов засчитано этим отсчётом (0, 1 или warmup при начале серии) */
    push(t, x, y, z) {
      const m = Math.sqrt(x * x + y * y + z * z);
      smooth = smooth == null ? m : smooth + 0.35 * (m - smooth);
      mean += 0.02 * (smooth - mean);
      let counted = 0;
      if (!above && smooth > mean + threshold) {
        above = true;
        const dt = lastStep == null ? Infinity : t - lastStep;
        if (dt >= minInterval) {
          streak = dt <= maxInterval ? streak + 1 : 1;
          lastStep = t;
          if (streak === warmup) counted = warmup; // серия подтверждена — засчитываем и её начало
          else if (streak > warmup) counted = 1;
        }
      } else if (above && smooth < mean) {
        above = false;
      }
      return counted;
    },
  };
}

// ------------------------------------------------------------------ шаги из «Здоровья»
// Сайт не может читать «Здоровье» напрямую; это делает команда iPhone. Ей передаются интервалы
// пеших этапов в «минутах назад» (команда отсчитывает от текущего времени — так не нужно
// разбирать даты), она возвращает сумму шагов по каждому: «95|80;40|30» → «820;410».

export const HEALTH_SHORTCUT = 'Road Tracker шаги';

/** Пешие этапы с началом и концом → интервалы в минутах назад от now. */
export function healthRanges(segments, now = Date.now()) {
  return segments
    .filter((s) => s.transport_type === 'walk' && s.started_at != null && s.finished_at != null && s.finished_at > s.started_at)
    .map((s) => ({
      id: s.id,
      fromMin: Math.ceil((now - s.started_at) / 60_000),
      toMin: Math.max(0, Math.floor((now - s.finished_at) / 60_000)),
    }));
}

export const healthInput = (ranges) => ranges.map((r) => `${r.fromMin}|${r.toMin}`).join(';');

/** Число из ответа команды: «1 234», «820,0», «820.0» → 1234 / 820; мусор → null. */
const toSteps = (x) => {
  const t = String(x).replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Math.round(Number(t));
  return n <= 200_000 ? n : null;
};

/** Ответ команды → Map(id этапа → шаги). Число значений должно совпасть с числом интервалов. */
export function parseHealthResult(result, ranges) {
  if (result == null) throw new Error('Команда ничего не вернула. Последним действием должно быть «Объединить текст».');
  // Пустое значение — за этот интервал в «Здоровье» нет шагов (0)
  const parts = String(result).replace(/\s+$/, '').split(/;|\n/);
  if (parts.length !== ranges.length) throw new Error(`Команда вернула ${parts.length} значений вместо ${ranges.length}. Проверьте шаги команды.`);
  const out = new Map();
  parts.forEach((p, i) => {
    const n = p.trim() === '' ? 0 : toSteps(p);
    if (n == null) throw new Error(`Команда вернула «${p.trim()}» — ожидалось число шагов.`);
    out.set(ranges[i].id, n);
  });
  return out;
}
