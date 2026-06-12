const MS_PER_DAY = 86_400_000;

/** Окно полного возврата при отмене подписки после оплаты (ADR-041). */
export const FULL_REFUND_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Правило 24 часов (ADR-041): отмена подписки в течение 24 часов с момента
 * оплаты БЕЗ использованных генераций → возврат полной суммы платежа.
 *
 * «Использованные генерации» — Generation компании с createdAt > paidAt и
 * status != FAILED (FAILED компенсирует лимит, ценность не получена; PENDING/
 * ANALYZING/GENERATING/DONE — использование). Подсчёт делает вызывающий код —
 * функция чистая и юнит-тестируемая. Clock skew (now < paidAt) → false:
 * сработает pro-rata, который и так cap'ится полной суммой.
 */
export function isFullRefundEligible(input: {
  /** Момент оплаты (paidAt последней SUCCEEDED-транзакции подписки). */
  paidAt: Date;
  now: Date;
  /** Генерации компании после paidAt со статусом != FAILED. */
  usedGenerations: number;
}): boolean {
  const ageMs = input.now.getTime() - input.paidAt.getTime();
  return input.usedGenerations === 0 && ageMs >= 0 && ageMs < FULL_REFUND_WINDOW_MS;
}

/**
 * Pro-rata расчёт возврата за неиспользованную часть оплаченного периода (ADR-036).
 *
 * totalDays — по ФАКТИЧЕСКОМУ отрезку (expiresAt − paidAt), а не по 30×months:
 * setMonth(+N) даёт периоды разной длины (28–31 день на месяц), и расчёт по
 * фиксированной длине мог бы дать возврат больше исходного платежа — ЮKassa
 * отвечает 400 «Refund amount larger than the initial payment amount».
 * Дополнительно сумма cap'ится исходной оплатой (defense-in-depth от
 * округлений и clock skew). Грабли перенесены из habby-tracker.
 */
export function computeRefund(input: {
  /** Сумма последнего успешного платежа за подписку, копейки. */
  price: number;
  /** Момент оплаты периода (paidAt транзакции; фолбэк — startedAt подписки). */
  paidAt: Date;
  /** Конец оплаченного периода. */
  expiresAt: Date;
  now: Date;
}): { amount: number; daysLeft: number; totalDays: number } {
  const totalDays = Math.max(
    1,
    Math.round((input.expiresAt.getTime() - input.paidAt.getTime()) / MS_PER_DAY),
  );
  const msLeft = input.expiresAt.getTime() - input.now.getTime();
  const daysLeft = Math.max(0, Math.min(totalDays, Math.floor(msLeft / MS_PER_DAY)));
  const amount = Math.min(input.price, Math.floor((input.price * daysLeft) / totalDays));
  return { amount, daysLeft, totalDays };
}
