/**
 * Интеграционные тесты биллинга (ЮKassa, ADR-035..038).
 *
 * ЮKassa мокается на уровне HTTP-клиента: YooKassaClient подменяется через
 * overrideProvider — сеть не используется, БД и весь NestJS-стек настоящие
 * (Testcontainers). Мок управляет ответами createPayment/getPayment/refundPayment,
 * чем эмулируются redirect-оплата, webhook-перепроверка и возвраты.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { YooKassaClient } from '../src/modules/billing/yookassa.client';
import type { YkPayment, YkRefund } from '../src/modules/billing/yookassa.types';
import { PrismaService } from '../src/prisma/prisma.service';
import { OnboardedUser, registerAndOnboard } from './helpers/api-helpers';
import { createTestApp } from './helpers/app-factory';
import { cleanDatabase } from './helpers/db-helpers';

/** Мок HTTP-клиента ЮKassa: in-memory платежи, без сети. */
class FakeYooKassaClient {
  payments = new Map<string, YkPayment>();
  refunds = new Map<string, YkRefund>();
  createPaymentCalls: Array<{ input: Record<string, unknown>; idempotenceKey: string }> = [];
  refundCalls: Array<{ input: Record<string, unknown>; idempotenceKey: string }> = [];
  /** Следующий refundPayment бросает ошибку (эмуляция отказа ЮKassa). */
  failNextRefund = false;
  private seq = 0;

  isConfigured(): boolean {
    return true;
  }

  async createPayment(
    input: { amount: { value: string }; save_payment_method?: boolean },
    idempotenceKey: string,
  ): Promise<YkPayment> {
    this.createPaymentCalls.push({ input: input as Record<string, unknown>, idempotenceKey });
    const id = `pay_${++this.seq}`;
    const payment: YkPayment = {
      id,
      status: 'pending',
      paid: false,
      amount: { value: input.amount.value, currency: 'RUB' },
      created_at: new Date().toISOString(),
      confirmation: {
        type: 'redirect',
        confirmation_url: `https://yookassa.test/checkout/${id}`,
        return_url: 'http://localhost:3001/app/billing?status=ok',
      },
    };
    this.payments.set(id, payment);
    return payment;
  }

  /** Тест «оплачивает» платёж: статус succeeded + сохранённый payment_method. */
  markSucceeded(paymentId: string, opts: { saveCard?: boolean } = {}): void {
    const p = this.payments.get(paymentId);
    if (!p) throw new Error(`Платёж ${paymentId} не найден в моке`);
    p.status = 'succeeded';
    p.paid = true;
    if (opts.saveCard) {
      p.payment_method = {
        type: 'bank_card',
        id: `pm_${paymentId}`,
        saved: true,
        card: { last4: '4444', card_type: 'MasterCard' },
      };
    }
  }

  async getPayment(id: string): Promise<YkPayment> {
    const p = this.payments.get(id);
    if (!p) throw new Error(`YooKassa /payments/${id} 404`);
    return p;
  }

  async refundPayment(
    input: { payment_id: string; amount: { value: string; currency: 'RUB' } },
    idempotenceKey: string,
  ): Promise<YkRefund> {
    this.refundCalls.push({ input: input as Record<string, unknown>, idempotenceKey });
    if (this.failNextRefund) {
      this.failNextRefund = false;
      throw new Error('YooKassa /refunds 400: Refund rejected');
    }
    const refund: YkRefund = {
      id: `ref_${++this.seq}`,
      payment_id: input.payment_id,
      status: 'succeeded',
      amount: { value: input.amount.value, currency: 'RUB' },
      created_at: new Date().toISOString(),
    };
    this.refunds.set(refund.id, refund);
    return refund;
  }

  async getRefund(id: string): Promise<YkRefund> {
    const r = this.refunds.get(id);
    if (!r) throw new Error(`YooKassa /refunds/${id} 404`);
    return r;
  }
}

describe('Биллинг ЮKassa (интеграция)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let yk: FakeYooKassaClient;

  beforeAll(async () => {
    yk = new FakeYooKassaClient();
    app = await createTestApp((builder) =>
      builder.overrideProvider(YooKassaClient).useValue(yk),
    );
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(app);
    yk.payments.clear();
    yk.refunds.clear();
    yk.createPaymentCalls = [];
    yk.refundCalls = [];
    yk.failNextRefund = false;
  });

  function api() {
    return request(app.getHttpServer());
  }

  /** Оплата подписки целиком: checkout → mark succeeded → webhook. */
  async function paySubscription(
    user: OnboardedUser,
    plan: 'START' | 'BUSINESS' = 'START',
    periodMonths = 1,
  ): Promise<{ paymentId: string; transactionId: string }> {
    const res = await api()
      .post('/api/v1/billing/checkout')
      .set('Authorization', `Bearer ${user.companyToken}`)
      .send({ kind: 'subscription', plan, periodMonths })
      .expect(200);
    const { transactionId } = res.body as { transactionId: string };
    const txn = await prisma.paymentTransaction.findUniqueOrThrow({
      where: { id: transactionId },
    });
    const paymentId = txn.providerPaymentId!;
    yk.markSucceeded(paymentId, { saveCard: true });
    await api()
      .post('/api/v1/billing/webhook')
      .send({ event: 'payment.succeeded', object: { id: paymentId } })
      .expect(200);
    return { paymentId, transactionId };
  }

  it('checkout подписки создаёт PENDING-транзакцию и возвращает confirmationUrl', async () => {
    const user = await registerAndOnboard(app);

    const res = await api()
      .post('/api/v1/billing/checkout')
      .set('Authorization', `Bearer ${user.companyToken}`)
      .send({ kind: 'subscription', plan: 'START', periodMonths: 1 })
      .expect(200);

    const body = res.body as { confirmationUrl: string; transactionId: string };
    expect(body.confirmationUrl).toContain('https://yookassa.test/checkout/');

    const txn = await prisma.paymentTransaction.findUniqueOrThrow({
      where: { id: body.transactionId },
    });
    expect(txn.status).toBe('PENDING');
    expect(txn.type).toBe('SUBSCRIPTION');
    expect(txn.amount).toBe(79_000); // дефолт PRICE_START_1M
    expect(txn.providerPaymentId).toMatch(/^pay_/);

    // save_payment_method для подписки, Idempotence-Key = id транзакции
    const call = yk.createPaymentCalls[0]!;
    expect(call.input['save_payment_method']).toBe(true);
    expect(call.input['capture']).toBe(true);
    expect(call.idempotenceKey).toBe(body.transactionId);

    // Подписка ещё не активирована — план FREE
    const company = await prisma.company.findUniqueOrThrow({ where: { id: user.companyId } });
    expect(company.plan).toBe('FREE');
  });

  it('webhook payment.succeeded активирует подписку, меняет план и сохраняет карту', async () => {
    const user = await registerAndOnboard(app);
    await paySubscription(user, 'START', 3);

    const company = await prisma.company.findUniqueOrThrow({ where: { id: user.companyId } });
    expect(company.plan).toBe('START');

    const sub = await prisma.subscription.findUniqueOrThrow({
      where: { companyId: user.companyId },
    });
    expect(sub.status).toBe('ACTIVE');
    expect(sub.periodMonths).toBe(3);
    expect(sub.autoRenew).toBe(true);
    expect(sub.paymentMethodId).toMatch(/^pm_/);
    expect(sub.cardLast4).toBe('4444');
    expect(sub.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // GET /billing отражает активную подписку
    const res = await api()
      .get('/api/v1/billing')
      .set('Authorization', `Bearer ${user.companyToken}`)
      .expect(200);
    const body = res.body as {
      plan: string;
      subscription: { plan: string; card: { last4: string } };
      usage: { limit: number };
      transactions: unknown[];
    };
    expect(body.plan).toBe('START');
    expect(body.subscription.card.last4).toBe('4444');
    expect(body.usage.limit).toBe(100); // LIMIT_START
    expect(body.transactions.length).toBeGreaterThan(0);
  });

  it('повторная доставка webhook идемпотентна (CAS PENDING → SUCCEEDED)', async () => {
    const user = await registerAndOnboard(app);
    const { paymentId } = await paySubscription(user);

    const before = await prisma.subscription.findUniqueOrThrow({
      where: { companyId: user.companyId },
    });

    // Тот же webhook ещё дважды
    await api()
      .post('/api/v1/billing/webhook')
      .send({ event: 'payment.succeeded', object: { id: paymentId } })
      .expect(200);
    await api()
      .post('/api/v1/billing/webhook')
      .send({ event: 'payment.succeeded', object: { id: paymentId } })
      .expect(200);

    const after = await prisma.subscription.findUniqueOrThrow({
      where: { companyId: user.companyId },
    });
    // Подписка не продлена повторно
    expect(after.expiresAt.toISOString()).toBe(before.expiresAt.toISOString());

    const succeeded = await prisma.paymentTransaction.count({
      where: { companyId: user.companyId, status: 'SUCCEEDED' },
    });
    expect(succeeded).toBe(1);
  });

  it('поддельный webhook (платёж не succeeded в API) отбрасывается перепроверкой', async () => {
    const user = await registerAndOnboard(app);
    const res = await api()
      .post('/api/v1/billing/checkout')
      .set('Authorization', `Bearer ${user.companyToken}`)
      .send({ kind: 'subscription', plan: 'START', periodMonths: 1 })
      .expect(200);
    const { transactionId } = res.body as { transactionId: string };
    const txn = await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: transactionId } });

    // Платёж в «ЮKassa» всё ещё pending, но злоумышленник шлёт succeeded
    await api()
      .post('/api/v1/billing/webhook')
      .send({ event: 'payment.succeeded', object: { id: txn.providerPaymentId } })
      .expect(200);

    const fresh = await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: transactionId } });
    expect(fresh.status).toBe('PENDING'); // не применился
    expect(await prisma.subscription.findUnique({ where: { companyId: user.companyId } })).toBeNull();
  });

  it('оплата пакета увеличивает packageCredits, карта не сохраняется', async () => {
    const user = await registerAndOnboard(app);

    const res = await api()
      .post('/api/v1/billing/checkout')
      .set('Authorization', `Bearer ${user.companyToken}`)
      .send({ kind: 'package', size: 50 })
      .expect(200);
    const { transactionId } = res.body as { transactionId: string };
    const txn = await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: transactionId } });
    expect(txn.amount).toBe(50_000); // PRICE_PACK_50
    expect(yk.createPaymentCalls[0]!.input['save_payment_method']).toBeUndefined();

    yk.markSucceeded(txn.providerPaymentId!);
    await api()
      .post('/api/v1/billing/webhook')
      .send({ event: 'payment.succeeded', object: { id: txn.providerPaymentId } })
      .expect(200);

    const company = await prisma.company.findUniqueOrThrow({ where: { id: user.companyId } });
    expect(company.packageCredits).toBe(50);
    expect(company.plan).toBe('FREE'); // пакет не меняет тариф
  });

  it('11-я генерация на FREE с пакетом проходит из пакета; без пакета — 402', async () => {
    const user = await registerAndOnboard(app);
    const period = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}`;

    // Лимит FREE (10) полностью «израсходован», в пакете 1 кредит
    await prisma.usageCounter.create({
      data: { companyId: user.companyId, period, used: 10 },
    });
    await prisma.company.update({
      where: { id: user.companyId },
      data: { packageCredits: 1 },
    });

    // 11-я генерация проходит — из пакета
    await api()
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${user.companyToken}`)
      .send({ source: 'YANDEX_MAPS', rawText: 'Отличный сервис, спасибо!' })
      .expect(202);

    const company = await prisma.company.findUniqueOrThrow({ where: { id: user.companyId } });
    expect(company.packageCredits).toBe(0);
    const counter = await prisma.usageCounter.findUniqueOrThrow({
      where: { companyId_period: { companyId: user.companyId, period } },
    });
    expect(counter.used).toBe(10); // лимит тарифа не пробит

    // 12-я — и лимит, и пакет пусты → 402 LIMIT_EXCEEDED
    const res = await api()
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${user.companyToken}`)
      .send({ source: 'YANDEX_MAPS', rawText: 'Ещё один отзыв' })
      .expect(402);
    expect((res.body as { code: string }).code).toBe('LIMIT_EXCEEDED');
  });

  it('cancel без генераций в течение 24ч: полный возврат 790,00, подписка EXPIRED, план FREE, транзакции REFUND/REFUNDED', async () => {
    const user = await registerAndOnboard(app);
    const { transactionId } = await paySubscription(user, 'START', 1);

    const res = await api()
      .post('/api/v1/billing/cancel')
      .set('Authorization', `Bearer ${user.companyToken}`)
      .expect(200);
    const { refundAmount } = res.body as { refundAmount: number };

    // Правило 24 часов (ADR-041): генераций после оплаты не было → полная сумма
    expect(refundAmount).toBe(79_000);

    const sub = await prisma.subscription.findUniqueOrThrow({
      where: { companyId: user.companyId },
    });
    expect(sub.status).toBe('EXPIRED');
    expect(sub.autoRenew).toBe(false);
    expect(sub.cancelReason).toBe('user-refund');

    const company = await prisma.company.findUniqueOrThrow({ where: { id: user.companyId } });
    expect(company.plan).toBe('FREE');

    const refundTxn = await prisma.paymentTransaction.findFirstOrThrow({
      where: { companyId: user.companyId, type: 'REFUND' },
    });
    expect(refundTxn.status).toBe('SUCCEEDED');
    expect(refundTxn.amount).toBe(79_000);
    expect(refundTxn.description).toContain('Полный возврат (отмена в течение 24 часов)');

    const original = await prisma.paymentTransaction.findUniqueOrThrow({
      where: { id: transactionId },
    });
    expect(original.status).toBe('REFUNDED');

    // Сумма возврата ушла в ЮKassa с Idempotence-Key = id REFUND-транзакции
    expect(yk.refundCalls[0]!.idempotenceKey).toBe(refundTxn.id);
    expect(yk.refundCalls[0]!.input['amount']).toEqual({ value: '790.00', currency: 'RUB' });

    // Повторная отмена → 409
    await api()
      .post('/api/v1/billing/cancel')
      .set('Authorization', `Bearer ${user.companyToken}`)
      .expect(409);
  });

  it('cancel с генерацией после оплаты (в течение 24ч): pro-rata, начатый день сгорает', async () => {
    const user = await registerAndOnboard(app);
    await paySubscription(user, 'START', 1);

    // Использованная генерация после оплаты (status != FAILED) — через relation Review
    await prisma.review.create({
      data: {
        companyId: user.companyId,
        source: 'YANDEX_MAPS',
        rawText: 'Отличный сервис!',
        generation: { create: { status: 'DONE' } },
      },
    });

    const res = await api()
      .post('/api/v1/billing/cancel')
      .set('Authorization', `Bearer ${user.companyToken}`)
      .expect(200);
    const { refundAmount } = res.body as { refundAmount: number };

    // Генерация была → действующий pro-rata: начатый день считается использованным
    expect(refundAmount).toBeGreaterThan(0);
    expect(refundAmount).toBeLessThan(79_000);

    const refundTxn = await prisma.paymentTransaction.findFirstOrThrow({
      where: { companyId: user.companyId, type: 'REFUND' },
    });
    expect(refundTxn.amount).toBe(refundAmount);
    expect(refundTxn.description).toContain('Возврат за неиспользованный период подписки');
  });

  it('cancel: FAILED-генерация не считается использованием → полный возврат', async () => {
    // ADR-042: воркер больше не сохраняет FAILED-строки, так что в живой системе
    // их нет; фильтр status != FAILED в countUsedGenerationsSince — страховка.
    // Сеем FAILED напрямую в БД, чтобы закрепить поведение фильтра.
    const user = await registerAndOnboard(app);
    await paySubscription(user, 'START', 1);

    await prisma.review.create({
      data: {
        companyId: user.companyId,
        source: 'YANDEX_MAPS',
        rawText: 'Отзыв, генерация по которому упала',
        generation: { create: { status: 'FAILED', error: 'LLM timeout' } },
      },
    });

    const res = await api()
      .post('/api/v1/billing/cancel')
      .set('Authorization', `Bearer ${user.companyToken}`)
      .expect(200);
    expect((res.body as { refundAmount: number }).refundAmount).toBe(79_000);
  });

  it('cancel позже 24 часов после оплаты: pro-rata несмотря на отсутствие генераций', async () => {
    const user = await registerAndOnboard(app);
    await paySubscription(user, 'START', 1);

    // «Состариваем» оплату: paidAt 25 часов назад (окно 24ч закрыто)
    const paidAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await prisma.paymentTransaction.updateMany({
      where: { companyId: user.companyId, type: 'SUBSCRIPTION', status: 'SUCCEEDED' },
      data: { paidAt },
    });

    const res = await api()
      .post('/api/v1/billing/cancel')
      .set('Authorization', `Bearer ${user.companyToken}`)
      .expect(200);
    const { refundAmount } = res.body as { refundAmount: number };
    expect(refundAmount).toBeGreaterThan(0);
    expect(refundAmount).toBeLessThan(79_000);

    const refundTxn = await prisma.paymentTransaction.findFirstOrThrow({
      where: { companyId: user.companyId, type: 'REFUND' },
    });
    expect(refundTxn.description).toContain('Возврат за неиспользованный период подписки');
  });

  it('отказ ЮKassa в возврате откатывает подписку и план (деньги не двигались)', async () => {
    const user = await registerAndOnboard(app);
    await paySubscription(user, 'BUSINESS', 1);
    yk.failNextRefund = true;

    await api()
      .post('/api/v1/billing/cancel')
      .set('Authorization', `Bearer ${user.companyToken}`)
      .expect(502);

    const sub = await prisma.subscription.findUniqueOrThrow({
      where: { companyId: user.companyId },
    });
    expect(sub.status).toBe('ACTIVE'); // откатили
    const company = await prisma.company.findUniqueOrThrow({ where: { id: user.companyId } });
    expect(company.plan).toBe('BUSINESS');
    const refundTxn = await prisma.paymentTransaction.findFirstOrThrow({
      where: { companyId: user.companyId, type: 'REFUND' },
    });
    expect(refundTxn.status).toBe('FAILED');
  });

  it('auto-renew выключается/включается; unbind-card отвязывает локально и гасит автопродление', async () => {
    const user = await registerAndOnboard(app);
    await paySubscription(user);

    await api()
      .post('/api/v1/billing/auto-renew')
      .set('Authorization', `Bearer ${user.companyToken}`)
      .send({ enabled: false })
      .expect(200);
    let sub = await prisma.subscription.findUniqueOrThrow({ where: { companyId: user.companyId } });
    expect(sub.autoRenew).toBe(false);

    await api()
      .post('/api/v1/billing/auto-renew')
      .set('Authorization', `Bearer ${user.companyToken}`)
      .send({ enabled: true })
      .expect(200);

    await api()
      .post('/api/v1/billing/unbind-card')
      .set('Authorization', `Bearer ${user.companyToken}`)
      .expect(200);
    sub = await prisma.subscription.findUniqueOrThrow({ where: { companyId: user.companyId } });
    expect(sub.paymentMethodId).toBeNull();
    expect(sub.cardLast4).toBeNull();
    expect(sub.autoRenew).toBe(false);

    // Повторная отвязка → 409 NO_BOUND_CARD; включить автопродление без карты → 409
    await api()
      .post('/api/v1/billing/unbind-card')
      .set('Authorization', `Bearer ${user.companyToken}`)
      .expect(409);
    const renewRes = await api()
      .post('/api/v1/billing/auto-renew')
      .set('Authorization', `Bearer ${user.companyToken}`)
      .send({ enabled: true })
      .expect(409);
    expect((renewRes.body as { code: string }).code).toBe('NO_BOUND_CARD');
  });

  it('cron/renewals: Bearer CRON_SECRET, продление в горизонте часа ставит платёж по сохранённой карте', async () => {
    const user = await registerAndOnboard(app);
    await paySubscription(user);

    // Подписка истекает через 30 минут — попадает в горизонт продления
    const soon = new Date(Date.now() + 30 * 60 * 1000);
    await prisma.subscription.update({
      where: { companyId: user.companyId },
      data: { expiresAt: soon },
    });

    await api().post('/api/v1/billing/cron/renewals').expect(401); // без секрета
    const res = await api()
      .post('/api/v1/billing/cron/renewals')
      .set('Authorization', 'Bearer test-cron-secret')
      .expect(200);
    expect((res.body as { charged: number }).charged).toBe(1);

    // Платёж по сохранённой карте, Idempotence-Key renewal:{subId}:{expiresAt}
    const renewalCall = yk.createPaymentCalls.at(-1)!;
    expect(renewalCall.input['payment_method_id']).toMatch(/^pm_/);
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { companyId: user.companyId } });
    expect(renewalCall.idempotenceKey).toBe(`renewal:${sub.id}:${soon.toISOString()}`);

    // Повторный проход в течение 15 минут не создаёт второй платёж (race-защита)
    const res2 = await api()
      .post('/api/v1/billing/cron/renewals')
      .set('Authorization', 'Bearer test-cron-secret')
      .expect(200);
    expect((res2.body as { charged: number }).charged).toBe(0);

    // Webhook оплаты продления сдвигает expiresAt от ТЕКУЩЕГО expiresAt
    const renewalTxn = await prisma.paymentTransaction.findFirstOrThrow({
      where: { companyId: user.companyId, type: 'SUBSCRIPTION', status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    yk.markSucceeded(renewalTxn.providerPaymentId!, { saveCard: true });
    await api()
      .post('/api/v1/billing/webhook')
      .send({ event: 'payment.succeeded', object: { id: renewalTxn.providerPaymentId } })
      .expect(200);
    const renewed = await prisma.subscription.findUniqueOrThrow({
      where: { companyId: user.companyId },
    });
    const expected = new Date(soon);
    expected.setMonth(expected.getMonth() + 1);
    expect(renewed.expiresAt.toISOString()).toBe(expected.toISOString());
  });

  it('webhook refund.succeeded закрывает PENDING-возврат', async () => {
    const user = await registerAndOnboard(app);
    const { paymentId } = await paySubscription(user);

    // Возврат, который ЮKassa приняла, но завершила асинхронно
    const refundTxn = await prisma.paymentTransaction.create({
      data: {
        companyId: user.companyId,
        type: 'REFUND',
        amount: 10_000,
        status: 'PENDING',
        providerPaymentId: 'refund:ref_async',
        description: 'Возврат (асинхронный)',
      },
    });
    yk.refunds.set('ref_async', {
      id: 'ref_async',
      payment_id: paymentId,
      status: 'succeeded',
      amount: { value: '100.00', currency: 'RUB' },
      created_at: new Date().toISOString(),
    });

    await api()
      .post('/api/v1/billing/webhook')
      .send({ event: 'refund.succeeded', object: { id: 'ref_async' } })
      .expect(200);

    const fresh = await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: refundTxn.id } });
    expect(fresh.status).toBe('SUCCEEDED');
  });
});

describe('Биллинг без ключей ЮKassa (реальный клиент, env пустой)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp(); // YooKassaClient настоящий, ключей в env нет
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(app);
  });

  it('checkout → 503 BILLING_DISABLED; GET /billing работает (billingEnabled=false)', async () => {
    const user = await registerAndOnboard(app);

    const res = await request(app.getHttpServer())
      .post('/api/v1/billing/checkout')
      .set('Authorization', `Bearer ${user.companyToken}`)
      .send({ kind: 'subscription', plan: 'START', periodMonths: 1 })
      .expect(503);
    expect((res.body as { code: string }).code).toBe('BILLING_DISABLED');

    const overview = await request(app.getHttpServer())
      .get('/api/v1/billing')
      .set('Authorization', `Bearer ${user.companyToken}`)
      .expect(200);
    const body = overview.body as { billingEnabled: boolean; plan: string };
    expect(body.billingEnabled).toBe(false);
    expect(body.plan).toBe('FREE');
  });
});
