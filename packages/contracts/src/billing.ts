import { z } from 'zod';
import { PlanSchema } from './enums';

/**
 * Контракты биллинга (ЮKassa): подписки START/BUSINESS на 1/3/6/12 месяцев
 * с автопродлением + разовые пакеты генераций (ADR-035..038).
 * Все суммы — в копейках.
 */

/** Платный план подписки (FREE подпиской не оформляется). */
export const SubscriptionPlanSchema = z.enum(['START', 'BUSINESS']);
export type SubscriptionPlan = z.infer<typeof SubscriptionPlanSchema>;

/** Период подписки в месяцах. */
export const PeriodMonthsSchema = z.union([
  z.literal(1),
  z.literal(3),
  z.literal(6),
  z.literal(12),
]);
export type PeriodMonths = z.infer<typeof PeriodMonthsSchema>;

/** Размер разового пакета генераций. */
export const PackageSizeSchema = z.union([z.literal(10), z.literal(50), z.literal(100)]);
export type PackageSize = z.infer<typeof PackageSizeSchema>;

export const SubscriptionStatusSchema = z.enum(['ACTIVE', 'CANCELLED', 'EXPIRED']);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>;

export const TxnTypeSchema = z.enum(['SUBSCRIPTION', 'PACKAGE', 'REFUND']);
export type TxnType = z.infer<typeof TxnTypeSchema>;

export const TxnStatusSchema = z.enum(['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED']);
export type TxnStatus = z.infer<typeof TxnStatusSchema>;

/** Активная/отменённая подписка в ответе GET /billing. */
export const SubscriptionDtoSchema = z.object({
  plan: SubscriptionPlanSchema,
  periodMonths: PeriodMonthsSchema,
  status: SubscriptionStatusSchema,
  price: z.number().int().min(0),
  startedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  autoRenew: z.boolean(),
  card: z.object({ last4: z.string(), brand: z.string().nullable() }).nullable(),
});
export type SubscriptionDto = z.infer<typeof SubscriptionDtoSchema>;

export const PaymentTransactionDtoSchema = z.object({
  id: z.string(),
  type: TxnTypeSchema,
  amount: z.number().int().min(0),
  status: TxnStatusSchema,
  plan: SubscriptionPlanSchema.nullable(),
  periodMonths: z.number().int().nullable(),
  packageSize: z.number().int().nullable(),
  description: z.string(),
  createdAt: z.string().datetime(),
  paidAt: z.string().datetime().nullable(),
});
export type PaymentTransactionDto = z.infer<typeof PaymentTransactionDtoSchema>;

/** Ответ GET /billing — текущий тариф + остатки + история транзакций. */
export const BillingOverviewSchema = z.object({
  plan: PlanSchema, // эффективный план компании (FREE при отсутствии подписки)
  subscription: SubscriptionDtoSchema.nullable(),
  usage: z.object({
    used: z.number().int().min(0),
    limit: z.number().int().min(0),
    period: z.string(), // "2026-06"
  }),
  packageCredits: z.number().int().min(0),
  /** Доступен ли checkout (настроена ли ЮKassa на сервере). */
  billingEnabled: z.boolean(),
  transactions: z.array(PaymentTransactionDtoSchema), // последние 20
});
export type BillingOverview = z.infer<typeof BillingOverviewSchema>;

/** POST /billing/checkout — покупка подписки или пакета. */
export const CheckoutDtoSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('subscription'),
    plan: SubscriptionPlanSchema,
    periodMonths: PeriodMonthsSchema,
  }),
  z.object({
    kind: z.literal('package'),
    size: PackageSizeSchema,
  }),
]);
export type CheckoutDto = z.infer<typeof CheckoutDtoSchema>;

export const CheckoutResponseSchema = z.object({
  /** URL страницы оплаты ЮKassa (redirect confirmation). */
  confirmationUrl: z.string(),
  transactionId: z.string(),
});
export type CheckoutResponse = z.infer<typeof CheckoutResponseSchema>;

/** POST /billing/auto-renew. */
export const AutoRenewDtoSchema = z.object({ enabled: z.boolean() });
export type AutoRenewDto = z.infer<typeof AutoRenewDtoSchema>;

/** Ответ POST /billing/cancel. */
export const CancelSubscriptionResponseSchema = z.object({
  /** Сумма pro-rata возврата в копейках (0 — возвращать нечего). */
  refundAmount: z.number().int().min(0),
});
export type CancelSubscriptionResponse = z.infer<typeof CancelSubscriptionResponseSchema>;
