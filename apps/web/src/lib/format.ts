/** Форматирование дат и месяцев (русские падежи) для текстов из COPY.md. */

const MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
] as const;

const MONTHS_PREPOSITIONAL = [
  'январе',
  'феврале',
  'марте',
  'апреле',
  'мае',
  'июне',
  'июле',
  'августе',
  'сентябре',
  'октябре',
  'ноябре',
  'декабре',
] as const;

const MONTHS_ACCUSATIVE = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
] as const;

/** «11 июня» */
export function formatDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS_GENITIVE[d.getMonth()]}`;
}

/** «11 июня, 14:32» */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${formatDay(iso)}, ${hh}:${mm}`;
}

/** Период "2026-06" → «июне» (предложный падеж, usage-label). */
export function periodPrepositional(period: string): string {
  const m = Number(period.slice(5, 7));
  return MONTHS_PREPOSITIONAL[m - 1] ?? period;
}

/** Период "2026-06" → «июнь» (винительный падеж, limit-title). */
export function periodAccusative(period: string): string {
  const m = Number(period.slice(5, 7));
  return MONTHS_ACCUSATIVE[m - 1] ?? period;
}

/** Период "2026-06" → дата обнуления счётчика: «1 июля». */
export function periodResetDate(period: string): string {
  const m = Number(period.slice(5, 7)); // 1..12
  const next = m === 12 ? 1 : m + 1;
  return `1 ${MONTHS_GENITIVE[next - 1]}`;
}

/** Plan enum → подпись тарифа: FREE → «Free». */
export function planLabel(plan: string): string {
  return plan.charAt(0) + plan.slice(1).toLowerCase();
}

/** Дата → value для <input type="date">. */
export function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
