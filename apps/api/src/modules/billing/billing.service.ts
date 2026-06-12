import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PaymentTransaction, Plan, Prisma } from '@prisma/client';
import type {
  BillingOverview,
  CancelSubscriptionResponse,
  CheckoutDto,
  CheckoutResponse,
  PaymentTransactionDto,
  PeriodMonths,
  SubscriptionPlan,
} from '@replydesk/contracts';
import { AppException } from '../../common/app.exception';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { UsageService } from '../usage/usage.service';
import { computeRefund } from './prorata';
import { YooKassaClient } from './yookassa.client';
import { buildReceipt, kopecksToYkValue } from './yookassa.types';
import type { YkPayment, YkWebhookEvent } from './yookassa.types';

const SUB_LABEL: Record<SubscriptionPlan, string> = { START: 'Старт', BUSINESS: 'Бизнес' };

/** Окно cron-продления: подписки, истекающие в ближайший час. */
const RENEWAL_HORIZON_MS = 60 * 60 * 1000;
/** Race-защита cron: недавняя PENDING-транзакция блокирует повторную попытку. */
const RENEWAL_DEDUP_MS = 15 * 60 * 1000;

/**
 * Биллинг через ЮKassa (ADR-035..038): подписки START/BUSINESS на 1/3/6/12 мес
 * с привязкой карты и автопродлением + разовые пакеты генераций.
 * Все суммы — копейки; тенант — companyId из JWT.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly yookassa: YooKassaClient,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // ---------- Цены ----------

  subscriptionPrice(plan: SubscriptionPlan, months: PeriodMonths): number {
    const key = `PRICE_${plan}_${months}M` as keyof Env;
    return this.config.get(key, { infer: true }) as number;
  }

  packagePrice(size: 10 | 50 | 100): number {
    const key = `PRICE_PACK_${size}` as keyof Env;
    return this.config.get(key, { infer: true }) as number;
  }

  // ---------- GET /billing ----------

  async getOverview(companyId: string): Promise<BillingOverview> {
    await this.reconcilePending(companyId);
    await this.expireIfOverdue(companyId);

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: { subscription: true },
    });
    if (!company) {
      throw new AppException('COMPANY_NOT_FOUND', 'Компания не найдена', 404);
    }

    const usage = await this.usage.getUsage(companyId, company.plan);
    const transactions = await this.prisma.paymentTransaction.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const sub = company.subscription;
    const showSub = sub && sub.status !== 'EXPIRED' ? sub : null;

    return {
      plan: company.plan,
      subscription: showSub
        ? {
            plan: showSub.plan as SubscriptionPlan,
            periodMonths: showSub.periodMonths as PeriodMonths,
            status: showSub.status,
            price: showSub.price,
            startedAt: showSub.startedAt.toISOString(),
            expiresAt: showSub.expiresAt.toISOString(),
            autoRenew: showSub.autoRenew,
            card: showSub.cardLast4
              ? { last4: showSub.cardLast4, brand: showSub.cardBrand }
              : null,
          }
        : null,
      usage,
      packageCredits: company.packageCredits,
      billingEnabled: this.yookassa.isConfigured(),
      transactions: transactions.map((t) => this.toTxnDto(t)),
    };
  }

  // ---------- POST /billing/checkout ----------

  async checkout(companyId: string, dto: CheckoutDto): Promise<CheckoutResponse> {
    if (!this.yookassa.isConfigured()) {
      throw new AppException('BILLING_DISABLED', 'Оплата временно недоступна', 503);
    }

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: { users: { take: 1, orderBy: { createdAt: 'asc' } } },
    });
    if (!company) {
      throw new AppException('COMPANY_NOT_FOUND', 'Компания не найдена', 404);
    }
    const email = company.users[0]?.email;

    const isSub = dto.kind === 'subscription';
    const amount = isSub
      ? this.subscriptionPrice(dto.plan, dto.periodMonths)
      : this.packagePrice(dto.size);
    const description = isSub
      ? `ReplyDesk: подписка «${SUB_LABEL[dto.plan]}» на ${dto.periodMonths} мес.`
      : `ReplyDesk: пакет ${dto.size} генераций`;

    const txn = await this.prisma.paymentTransaction.create({
      data: {
        companyId,
        type: isSub ? 'SUBSCRIPTION' : 'PACKAGE',
        amount,
        status: 'PENDING',
        plan: isSub ? dto.plan : null,
        periodMonths: isSub ? dto.periodMonths : null,
        packageSize: isSub ? null : dto.size,
        description,
      },
    });

    // Idempotence-Key = id нашей транзакции: повторный createPayment по тому же
    // ключу возвращает исходный платёж, а не второе списание.
    const payment = await this.yookassa.createPayment(
      {
        amount: { value: kopecksToYkValue(amount), currency: 'RUB' },
        capture: true,
        // Карта сохраняется только для подписок (автопродление); пакеты — разовые.
        ...(isSub ? { save_payment_method: true } : {}),
        confirmation: {
          type: 'redirect',
          return_url: `${this.config.get('APP_URL', { infer: true })}/app/billing?status=ok`,
        },
        description,
        ...(email ? { receipt: buildReceipt({ email, amountKopecks: amount, description }) } : {}),
        metadata: { txn_id: txn.id, company_id: companyId },
      },
      txn.id,
    );

    await this.prisma.paymentTransaction.update({
      where: { id: txn.id },
      data: { providerPaymentId: payment.id },
    });

    const confirmationUrl = payment.confirmation?.confirmation_url;
    if (!confirmationUrl) {
      throw new AppException('INTERNAL', 'ЮKassa не вернула ссылку на оплату', 502);
    }
    return { confirmationUrl, transactionId: txn.id };
  }

  // ---------- POST /billing/webhook ----------

  /**
   * HTTP-уведомления ЮKassa приходят БЕЗ подписи. Defense-in-depth (ADR-038):
   * доверяем только перепроверке через GET /v3/payments/{id} (или /refunds/{id})
   * с нашими Basic Auth учётными данными; идемпотентность — compare-and-swap
   * PENDING → SUCCEEDED (повторная доставка видит count=0 и выходит).
   * Бросок исключения → 500 → ЮKassa повторит доставку.
   */
  async handleWebhook(body: unknown): Promise<void> {
    const event = this.parseWebhookBody(body);
    if (!event) {
      this.logger.warn('Webhook ЮKassa: некорректное тело — игнорируем');
      return;
    }

    if (event.event === 'payment.succeeded' || event.event === 'payment.canceled') {
      const fresh = await this.yookassa.getPayment(event.object.id);
      if (event.event === 'payment.succeeded' && fresh.status !== 'succeeded') {
        this.logger.warn(
          `Webhook payment.succeeded для ${event.object.id} не совпал с API (${fresh.status}) — отброшен`,
        );
        return;
      }
      if (event.event === 'payment.canceled' && fresh.status !== 'canceled') {
        this.logger.warn(
          `Webhook payment.canceled для ${event.object.id} не совпал с API (${fresh.status}) — отброшен`,
        );
        return;
      }
      if (event.event === 'payment.succeeded') {
        await this.applySucceededPayment(fresh);
      } else {
        await this.prisma.paymentTransaction.updateMany({
          where: { providerPaymentId: fresh.id, status: 'PENDING' },
          data: { status: 'FAILED' },
        });
      }
      return;
    }

    if (event.event === 'refund.succeeded') {
      const fresh = await this.yookassa.getRefund(event.object.id);
      if (fresh.status !== 'succeeded') {
        this.logger.warn(
          `Webhook refund.succeeded для ${event.object.id} не совпал с API (${fresh.status}) — отброшен`,
        );
        return;
      }
      const won = await this.prisma.paymentTransaction.updateMany({
        where: { providerPaymentId: `refund:${fresh.id}`, status: 'PENDING' },
        data: { status: 'SUCCEEDED', paidAt: new Date() },
      });
      if (won.count > 0) {
        // Исходный платёж помечаем REFUNDED
        await this.prisma.paymentTransaction.updateMany({
          where: { providerPaymentId: fresh.payment_id, status: 'SUCCEEDED' },
          data: { status: 'REFUNDED' },
        });
      }
      return;
    }
    // payment.waiting_for_capture при capture:true не ожидается — игнорируем
  }

  /**
   * Self-heal при открытии страницы тарифа (паттерн habby-tracker): если вебхук
   * не доставлен (локальный стенд без публичного URL, сбой доставки), PENDING-платежи
   * за последние 24 часа сверяются с ЮKassa напрямую и применяются тем же путём,
   * что и вебхук. Ошибки сверки не валят GET /billing.
   */
  private async reconcilePending(companyId: string): Promise<void> {
    if (!this.yookassa.isConfigured()) return;
    const pending = await this.prisma.paymentTransaction.findMany({
      where: {
        companyId,
        status: 'PENDING',
        type: { in: ['SUBSCRIPTION', 'PACKAGE'] },
        providerPaymentId: { not: null },
        createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    for (const txn of pending) {
      try {
        const fresh = await this.yookassa.getPayment(txn.providerPaymentId as string);
        if (fresh.status === 'succeeded') {
          await this.applySucceededPayment(fresh);
        } else if (fresh.status === 'canceled') {
          await this.prisma.paymentTransaction.updateMany({
            where: { id: txn.id, status: 'PENDING' },
            data: { status: 'FAILED' },
          });
        }
      } catch (err) {
        this.logger.warn(
          `Сверка PENDING-платежа ${txn.id} с ЮKassa не удалась: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  /**
   * Применение успешного платежа: CAS PENDING → SUCCEEDED (идемпотентность),
   * затем активация подписки или начисление пакетных кредитов + sync Company.plan.
   */
  private async applySucceededPayment(payment: YkPayment): Promise<void> {
    const txn = await this.prisma.paymentTransaction.findUnique({
      where: { providerPaymentId: payment.id },
    });
    if (!txn) {
      this.logger.warn(`Webhook: транзакция для платежа ${payment.id} не найдена — пропуск`);
      return;
    }

    const won = await this.prisma.paymentTransaction.updateMany({
      where: { id: txn.id, status: 'PENDING' },
      data: { status: 'SUCCEEDED', paidAt: new Date() },
    });
    if (won.count !== 1) return; // повторная доставка — уже применено

    if (txn.type === 'PACKAGE' && txn.packageSize) {
      await this.prisma.company.update({
        where: { id: txn.companyId },
        data: { packageCredits: { increment: txn.packageSize } },
      });
      return;
    }

    if (txn.type === 'SUBSCRIPTION' && txn.plan && txn.periodMonths) {
      // payment_method может НЕ сохраниться (saved=false) — graceful null;
      // маску карты не переносим со старой карты, чтобы UI не показывал устаревшую.
      const method = payment.payment_method;
      const saved = method?.saved ? method.id : null;
      const card = method?.type === 'bank_card' ? method.card : undefined;
      await this.activateSubscription(txn.companyId, txn.plan, txn.periodMonths, txn.amount, {
        paymentMethodId: saved,
        cardLast4: card?.last4 ?? null,
        cardBrand: card?.card_type ?? null,
      });
    }
  }

  /**
   * Upsert подписки: если текущая активна и не истекла — продление от её
   * expiresAt (оплата заранее не съедает оплаченные дни), иначе период от now.
   * Company.plan синхронизируется с планом подписки.
   */
  private async activateSubscription(
    companyId: string,
    plan: Plan,
    periodMonths: number,
    price: number,
    card: { paymentMethodId: string | null; cardLast4: string | null; cardBrand: string | null },
  ): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.subscription.findUnique({ where: { companyId } });
      const base =
        existing && existing.status === 'ACTIVE' && existing.expiresAt > now && existing.plan === plan
          ? existing.expiresAt
          : now;
      const expiresAt = this.addMonths(base, periodMonths);

      await tx.subscription.upsert({
        where: { companyId },
        create: {
          companyId,
          plan,
          periodMonths,
          status: 'ACTIVE',
          price,
          startedAt: now,
          expiresAt,
          autoRenew: true,
          ...card,
        },
        update: {
          plan,
          periodMonths,
          status: 'ACTIVE',
          price,
          expiresAt,
          autoRenew: true,
          // Если ЮKassa не сохранила payment_method — не затираем существующую привязку
          paymentMethodId: card.paymentMethodId ?? undefined,
          cardLast4: card.cardLast4,
          cardBrand: card.cardBrand,
          cancelledAt: null,
          cancelReason: null,
        },
      });
      await tx.company.update({ where: { id: companyId }, data: { plan } });
    });
  }

  // ---------- POST /billing/auto-renew ----------

  async setAutoRenew(companyId: string, enabled: boolean): Promise<void> {
    const where: Prisma.SubscriptionWhereInput = enabled
      ? { companyId, status: 'ACTIVE', paymentMethodId: { not: null } }
      : { companyId, status: 'ACTIVE' };
    const updated = await this.prisma.subscription.updateMany({
      where,
      data: { autoRenew: enabled },
    });
    if (updated.count === 0) {
      const sub = await this.prisma.subscription.findUnique({ where: { companyId } });
      if (enabled && sub && sub.status === 'ACTIVE' && !sub.paymentMethodId) {
        throw new AppException('NO_BOUND_CARD', 'Нет привязанной карты для автопродления', 409);
      }
      throw new AppException('NO_ACTIVE_SUBSCRIPTION', 'Нет активной подписки', 409);
    }
  }

  // ---------- POST /billing/unbind-card ----------

  /**
   * Отвязка карты — только локально: у API ЮKassa нет endpoint удаления
   * payment_method. Обнуляем привязку + выключаем автопродление атомарно;
   * updateMany с paymentMethodId != null — идемпотентность повторных нажатий.
   */
  async unbindCard(companyId: string): Promise<void> {
    const updated = await this.prisma.subscription.updateMany({
      where: { companyId, paymentMethodId: { not: null } },
      data: { paymentMethodId: null, cardLast4: null, cardBrand: null, autoRenew: false },
    });
    if (updated.count === 0) {
      throw new AppException('NO_BOUND_CARD', 'Привязанная карта не найдена', 409);
    }
  }

  // ---------- POST /billing/cancel ----------

  /**
   * Отмена подписки с pro-rata возвратом (ADR-036): compare-and-swap
   * ACTIVE → EXPIRED (двойной клик не даёт второго возврата), расчёт по
   * фактическим дням с cap на исходную оплату, refund через ЮKassa;
   * при отказе ЮKassa — откат подписки и плана.
   */
  async cancel(companyId: string): Promise<CancelSubscriptionResponse> {
    const now = new Date();
    const sub = await this.prisma.subscription.findUnique({ where: { companyId } });
    if (!sub || sub.status !== 'ACTIVE' || sub.expiresAt <= now) {
      throw new AppException('NO_ACTIVE_SUBSCRIPTION', 'Нет активной подписки', 409);
    }

    const lastPayment = await this.prisma.paymentTransaction.findFirst({
      where: { companyId, type: 'SUBSCRIPTION', status: 'SUCCEEDED' },
      orderBy: { paidAt: 'desc' },
    });

    const refund = computeRefund({
      price: lastPayment?.amount ?? sub.price,
      paidAt: lastPayment?.paidAt ?? sub.startedAt,
      expiresAt: sub.expiresAt,
      now,
    });

    // Возврат денег требует сконфигурированной ЮKassa — проверяем ДО CAS.
    if (refund.amount > 0 && lastPayment?.providerPaymentId && !this.yookassa.isConfigured()) {
      throw new AppException('BILLING_DISABLED', 'Оплата временно недоступна', 503);
    }

    // Атомарный захват: только один конкурентный вызов переводит подписку в EXPIRED.
    const won = await this.prisma.subscription.updateMany({
      where: { companyId, status: 'ACTIVE', expiresAt: { gt: now } },
      data: {
        status: 'EXPIRED',
        expiresAt: now,
        autoRenew: false,
        cancelledAt: now,
        cancelReason: 'user-refund',
      },
    });
    if (won.count !== 1) {
      throw new AppException('NO_ACTIVE_SUBSCRIPTION', 'Нет активной подписки', 409);
    }
    await this.prisma.company.update({ where: { id: companyId }, data: { plan: 'FREE' } });

    if (refund.amount === 0 || !lastPayment?.providerPaymentId) {
      return { refundAmount: 0 };
    }

    // REFUND-транзакция создаётся ДО вызова ЮKassa — её id служит Idempotence-Key.
    const refundTxn = await this.prisma.paymentTransaction.create({
      data: {
        companyId,
        type: 'REFUND',
        amount: refund.amount,
        status: 'PENDING',
        description: `Возврат за неиспользованный период подписки (${refund.daysLeft} из ${refund.totalDays} дн.)`,
      },
    });

    try {
      const ykRefund = await this.yookassa.refundPayment(
        {
          payment_id: lastPayment.providerPaymentId,
          amount: { value: kopecksToYkValue(refund.amount), currency: 'RUB' },
          description: `Refund for txn ${lastPayment.id}`,
        },
        refundTxn.id,
      );
      const succeeded = ykRefund.status === 'succeeded';
      await this.prisma.paymentTransaction.update({
        where: { id: refundTxn.id },
        data: {
          providerPaymentId: `refund:${ykRefund.id}`,
          status: succeeded ? 'SUCCEEDED' : 'PENDING',
          paidAt: succeeded ? new Date() : null,
        },
      });
      if (succeeded) {
        await this.prisma.paymentTransaction.update({
          where: { id: lastPayment.id },
          data: { status: 'REFUNDED' },
        });
      }
    } catch (e) {
      // ЮKassa отклонила возврат — деньги не двигались: откатываем подписку
      // и план, чтобы пользователь не остался и без доступа, и без денег.
      await this.prisma.paymentTransaction.update({
        where: { id: refundTxn.id },
        data: { status: 'FAILED' },
      });
      await this.prisma.subscription.update({
        where: { companyId },
        data: {
          status: sub.status,
          expiresAt: sub.expiresAt,
          autoRenew: sub.autoRenew,
          cancelledAt: sub.cancelledAt,
          cancelReason: sub.cancelReason,
        },
      });
      await this.prisma.company.update({
        where: { id: companyId },
        data: { plan: sub.plan },
      });
      this.logger.error(
        `Возврат по подписке компании ${companyId} отклонён ЮKassa: ${e instanceof Error ? e.message : String(e)}`,
      );
      throw new AppException('INTERNAL', 'Не удалось выполнить возврат — попробуйте позже', 502);
    }

    return { refundAmount: refund.amount };
  }

  // ---------- POST /billing/cron/renewals ----------

  /**
   * Cron-проход автопродления (паттерн habby-tracker): горизонт 1 час,
   * race-защита 15 минут через недавнюю PENDING-транзакцию, Idempotence-Key
   * `renewal:{subId}:{expiresAt}` — повторный проход бьёт в тот же платёж.
   * Дополнительно переводит просроченные подписки в EXPIRED + план FREE.
   */
  async runRenewalSweep(now: Date = new Date()): Promise<{ tried: number; charged: number; expired: number }> {
    const expired = await this.expireAllOverdue(now);

    if (!this.yookassa.isConfigured()) {
      return { tried: 0, charged: 0, expired };
    }

    const horizon = new Date(now.getTime() + RENEWAL_HORIZON_MS);
    const due = await this.prisma.subscription.findMany({
      where: {
        status: 'ACTIVE',
        autoRenew: true,
        paymentMethodId: { not: null },
        expiresAt: { gte: now, lte: horizon },
      },
      include: { company: { include: { users: { take: 1, orderBy: { createdAt: 'asc' } } } } },
    });

    let charged = 0;
    for (const sub of due) {
      const recentPending = await this.prisma.paymentTransaction.findFirst({
        where: {
          companyId: sub.companyId,
          type: 'SUBSCRIPTION',
          status: 'PENDING',
          createdAt: { gt: new Date(Date.now() - RENEWAL_DEDUP_MS) },
        },
      });
      if (recentPending) continue;

      try {
        const description = `ReplyDesk: автопродление подписки «${SUB_LABEL[sub.plan as SubscriptionPlan] ?? sub.plan}» на ${sub.periodMonths} мес.`;
        const txn = await this.prisma.paymentTransaction.create({
          data: {
            companyId: sub.companyId,
            type: 'SUBSCRIPTION',
            amount: sub.price,
            status: 'PENDING',
            plan: sub.plan,
            periodMonths: sub.periodMonths,
            description,
          },
        });
        const email = sub.company.users[0]?.email;
        const payment = await this.yookassa.createPayment(
          {
            amount: { value: kopecksToYkValue(sub.price), currency: 'RUB' },
            capture: true,
            payment_method_id: sub.paymentMethodId!,
            description,
            ...(email
              ? { receipt: buildReceipt({ email, amountKopecks: sub.price, description }) }
              : {}),
            metadata: { txn_id: txn.id, company_id: sub.companyId, kind: 'renewal' },
          },
          `renewal:${sub.id}:${sub.expiresAt.toISOString()}`,
        );
        await this.prisma.paymentTransaction.update({
          where: { id: txn.id },
          data: { providerPaymentId: payment.id },
        });
        charged++; // успех придёт webhook'ом payment.succeeded
      } catch (e) {
        this.logger.error(
          `Автопродление подписки ${sub.id} не удалось: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    return { tried: due.length, charged, expired };
  }

  // ---------- Внутреннее ----------

  /** Ленивая проверка одного тенанта: истёкшая подписка → EXPIRED + план FREE. */
  private async expireIfOverdue(companyId: string): Promise<void> {
    const won = await this.prisma.subscription.updateMany({
      where: { companyId, status: 'ACTIVE', expiresAt: { lte: new Date() } },
      data: { status: 'EXPIRED', autoRenew: false },
    });
    if (won.count > 0) {
      await this.prisma.company.update({ where: { id: companyId }, data: { plan: 'FREE' } });
    }
  }

  /** Массовый перевод просроченных подписок в EXPIRED (cron). */
  private async expireAllOverdue(now: Date): Promise<number> {
    const overdue = await this.prisma.subscription.findMany({
      where: { status: 'ACTIVE', expiresAt: { lte: now } },
      select: { companyId: true },
    });
    let count = 0;
    for (const { companyId } of overdue) {
      const won = await this.prisma.subscription.updateMany({
        where: { companyId, status: 'ACTIVE', expiresAt: { lte: now } },
        data: { status: 'EXPIRED', autoRenew: false },
      });
      if (won.count > 0) {
        await this.prisma.company.update({ where: { id: companyId }, data: { plan: 'FREE' } });
        count++;
      }
    }
    return count;
  }

  /** Календарное прибавление месяцев (семантика Date.setMonth). */
  private addMonths(from: Date, months: number): Date {
    const d = new Date(from);
    d.setMonth(d.getMonth() + months);
    return d;
  }

  private parseWebhookBody(body: unknown): YkWebhookEvent | null {
    if (
      typeof body !== 'object' ||
      body === null ||
      typeof (body as { event?: unknown }).event !== 'string' ||
      typeof (body as { object?: unknown }).object !== 'object' ||
      (body as { object: { id?: unknown } }).object === null ||
      typeof (body as { object: { id?: unknown } }).object.id !== 'string'
    ) {
      return null;
    }
    const event = (body as { event: string }).event;
    if (
      event !== 'payment.succeeded' &&
      event !== 'payment.canceled' &&
      event !== 'payment.waiting_for_capture' &&
      event !== 'refund.succeeded'
    ) {
      return null;
    }
    return body as YkWebhookEvent;
  }

  private toTxnDto(t: PaymentTransaction): PaymentTransactionDto {
    return {
      id: t.id,
      type: t.type,
      amount: t.amount,
      status: t.status,
      plan: (t.plan === 'START' || t.plan === 'BUSINESS' ? t.plan : null) as PaymentTransactionDto['plan'],
      periodMonths: t.periodMonths,
      packageSize: t.packageSize,
      description: t.description,
      createdAt: t.createdAt.toISOString(),
      paidAt: t.paidAt?.toISOString() ?? null,
    };
  }
}
