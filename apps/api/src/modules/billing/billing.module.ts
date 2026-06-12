import { Module } from '@nestjs/common';
import { UsageModule } from '../usage/usage.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { YooKassaClient } from './yookassa.client';

/**
 * Биллинг через ЮKassa (ADR-035..038): подписки с автопродлением,
 * разовые пакеты генераций, отмена с pro-rata возвратом.
 * YooKassaClient — инжектируемый HTTP-клиент: в тестах подменяется
 * через overrideProvider(YooKassaClient).
 */
@Module({
  imports: [UsageModule],
  controllers: [BillingController],
  providers: [BillingService, YooKassaClient],
  exports: [BillingService],
})
export class BillingModule {}
