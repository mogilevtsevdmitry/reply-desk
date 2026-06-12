const MS_PER_DAY = 86_400_000;

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
