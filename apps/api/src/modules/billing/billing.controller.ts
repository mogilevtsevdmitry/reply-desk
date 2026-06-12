import { timingSafeEqual } from 'node:crypto';
import { Body, Controller, Get, Headers, HttpCode, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AutoRenewDto,
  AutoRenewDtoSchema,
  BillingOverview,
  CancelSubscriptionResponse,
  CheckoutDto,
  CheckoutDtoSchema,
  CheckoutResponse,
} from '@replydesk/contracts';
import { AppException } from '../../common/app.exception';
import { CurrentCompanyId, Public } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import type { Env } from '../../config/env';
import { BillingService } from './billing.service';

@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Текущий тариф: подписка, карта, остатки лимита/пакета, история транзакций. */
  @Get()
  async overview(@CurrentCompanyId() companyId: string): Promise<BillingOverview> {
    return this.billing.getOverview(companyId);
  }

  /** Покупка подписки или пакета → ссылка на оплату ЮKassa. 503 без ключей ЮKassa. */
  @Post('checkout')
  @HttpCode(200)
  async checkout(
    @CurrentCompanyId() companyId: string,
    @Body(new ZodValidationPipe(CheckoutDtoSchema)) dto: CheckoutDto,
  ): Promise<CheckoutResponse> {
    return this.billing.checkout(companyId, dto);
  }

  /**
   * HTTP-уведомления ЮKassa — ПУБЛИЧНЫЙ endpoint (ЮKassa не умеет JWT).
   * Аутентичность — перепроверкой платежа через GET к API ЮKassa (ADR-038);
   * идемпотентность — compare-and-swap в BillingService.
   */
  @Public()
  @Post('webhook')
  @HttpCode(200)
  async webhook(@Body() body: unknown): Promise<{ ok: true }> {
    await this.billing.handleWebhook(body);
    return { ok: true };
  }

  /** Вкл/выкл автопродление. 409, если нет подписки или карты. */
  @Post('auto-renew')
  @HttpCode(200)
  async autoRenew(
    @CurrentCompanyId() companyId: string,
    @Body(new ZodValidationPipe(AutoRenewDtoSchema)) dto: AutoRenewDto,
  ): Promise<{ ok: true }> {
    await this.billing.setAutoRenew(companyId, dto.enabled);
    return { ok: true };
  }

  /** Локальная отвязка карты (у ЮKassa нет delete-endpoint) + autoRenew=false. */
  @Post('unbind-card')
  @HttpCode(200)
  async unbindCard(@CurrentCompanyId() companyId: string): Promise<{ ok: true }> {
    await this.billing.unbindCard(companyId);
    return { ok: true };
  }

  /** Отмена подписки с pro-rata возвратом за неиспользованные дни. */
  @Post('cancel')
  @HttpCode(200)
  async cancel(@CurrentCompanyId() companyId: string): Promise<CancelSubscriptionResponse> {
    return this.billing.cancel(companyId);
  }

  /**
   * Проход автопродления — дергается внешним cron'ом.
   * Защита: Bearer CRON_SECRET (timing-safe сравнение), не JWT.
   */
  @Public()
  @Post('cron/renewals')
  @HttpCode(200)
  async cronRenewals(
    @Headers('authorization') authorization?: string,
  ): Promise<{ tried: number; charged: number; expired: number }> {
    const secret = this.config.get('CRON_SECRET', { infer: true });
    if (!secret) {
      throw new AppException('BILLING_DISABLED', 'CRON_SECRET не настроен', 503);
    }
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : '';
    const a = Buffer.from(token);
    const b = Buffer.from(secret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new AppException('UNAUTHORIZED', 'Неверный cron-секрет', 401);
    }
    return this.billing.runRenewalSweep();
  }
}
