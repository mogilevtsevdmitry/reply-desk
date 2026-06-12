import type { PackageSize, PeriodMonths, SubscriptionPlan } from '@replydesk/contracts';

/**
 * Статичная тарифная сетка для отображения на /app/billing. Все суммы — в КОПЕЙКАХ.
 *
 * ВАЖНО: значения должны совпадать с env API `PRICE_{PLAN}_{N}M` / `PRICE_PACK_{N}`
 * (apps/api/src/config/env.ts, дефолты — ADR-035). Бэкенд не отдаёт прайс
 * в BillingOverview, поэтому при смене цен в env эту таблицу нужно
 * синхронизировать вручную (ADR-039).
 */
export const SUBSCRIPTION_PRICES: Record<SubscriptionPlan, Record<PeriodMonths, number>> = {
  START: { 1: 79_000, 3: 219_000, 6: 399_000, 12: 699_000 },
  BUSINESS: { 1: 599_000, 3: 1_649_000, 6: 2_999_000, 12: 5_399_000 },
};

export const PACKAGE_PRICES: Record<PackageSize, number> = {
  10: 10_000,
  50: 50_000,
  100: 100_000,
};

/** Месячный лимит генераций платных тарифов (= env LIMIT_START / LIMIT_BUSINESS). */
export const PLAN_LIMITS: Record<SubscriptionPlan, number> = { START: 100, BUSINESS: 1000 };

export const SUBSCRIPTION_PLANS: readonly SubscriptionPlan[] = ['START', 'BUSINESS'];
export const PERIOD_OPTIONS: readonly PeriodMonths[] = [1, 3, 6, 12];
export const PACKAGE_SIZES: readonly PackageSize[] = [10, 50, 100];

/** Цена периода в месяц (копейки, округление до копейки). */
export function perMonthPrice(plan: SubscriptionPlan, months: PeriodMonths): number {
  return Math.round(SUBSCRIPTION_PRICES[plan][months] / months);
}

/** Выгода периода в % против помесячной оплаты (0 для 1 месяца). */
export function periodDiscountPct(plan: SubscriptionPlan, months: PeriodMonths): number {
  if (months === 1) return 0;
  const monthly = SUBSCRIPTION_PRICES[plan][1];
  const period = SUBSCRIPTION_PRICES[plan][months];
  return Math.round((1 - period / (monthly * months)) * 100);
}
