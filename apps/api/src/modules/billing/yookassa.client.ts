import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import type { YkCreatePaymentInput, YkPayment, YkRefund } from './yookassa.types';

const BASE = 'https://api.yookassa.ru/v3';

/** Ошибка HTTP-уровня ЮKassa (не 2xx). */
export class YooKassaError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
    body: string,
  ) {
    super(`YooKassa ${path} ${status}: ${body}`);
    this.name = 'YooKassaError';
  }
}

/**
 * Кастомный HTTP-клиент ЮKassa v3 (fetch + Basic Auth shop_id:secret_key),
 * npm-пакет НЕ используется (паттерн habby-tracker). Инжектируемый класс —
 * в интеграционных тестах подменяется через overrideProvider(YooKassaClient).
 *
 * Idempotence-Key обязателен для всех POST: вызывающий передаёт стабильный
 * ключ от локальной сущности (id PaymentTransaction, `renewal:{subId}:{expiresAt}`) —
 * повторный вызов возвращает исходный платёж вместо второго списания.
 */
@Injectable()
export class YooKassaClient {
  private readonly shopId?: string;
  private readonly secretKey?: string;

  constructor(config: ConfigService<Env, true>) {
    this.shopId = config.get('YOOKASSA_SHOP_ID', { infer: true });
    this.secretKey = config.get('YOOKASSA_SECRET_KEY', { infer: true });
  }

  /** Заданы ли учётные данные магазина (иначе checkout → 503 BILLING_DISABLED). */
  isConfigured(): boolean {
    return Boolean(this.shopId && this.secretKey);
  }

  createPayment(input: YkCreatePaymentInput, idempotenceKey: string): Promise<YkPayment> {
    return this.call('POST', '/payments', idempotenceKey, input);
  }

  getPayment(id: string): Promise<YkPayment> {
    return this.call('GET', `/payments/${id}`, randomUUID());
  }

  refundPayment(
    input: { payment_id: string; amount: { value: string; currency: 'RUB' }; description?: string },
    idempotenceKey: string,
  ): Promise<YkRefund> {
    return this.call('POST', '/refunds', idempotenceKey, input);
  }

  getRefund(id: string): Promise<YkRefund> {
    return this.call('GET', `/refunds/${id}`, randomUUID());
  }

  private async call<T>(
    method: 'POST' | 'GET',
    path: string,
    idempotenceKey: string,
    body?: unknown,
  ): Promise<T> {
    if (!this.isConfigured()) {
      throw new YooKassaError(path, 0, 'ЮKassa не сконфигурирована (YOOKASSA_SHOP_ID/SECRET_KEY)');
    }
    const auth = Buffer.from(`${this.shopId}:${this.secretKey}`).toString('base64');
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
        'Idempotence-Key': idempotenceKey,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new YooKassaError(path, res.status, await res.text());
    }
    return (await res.json()) as T;
  }
}
