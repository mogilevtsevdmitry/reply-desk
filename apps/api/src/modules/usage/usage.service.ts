import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Plan, Prisma } from '@prisma/client';
import { AppException } from '../../common/app.exception';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Источник, из которого списана генерация (ADR-037):
 * PLAN — месячный лимит тарифа (UsageCounter), PACKAGE — пакетные кредиты
 * (Company.packageCredits). Хранится в job BullMQ — компенсация при FAILED
 * возвращает генерацию туда, откуда списали.
 */
export type UsageSource = 'PLAN' | 'PACKAGE';

/**
 * Лимиты генераций по модели «резервирование» (ADR-002, порядок списания — ADR-037):
 * - reserve() — атомарное списание внутри транзакции вызывающего
 *   (POST /reviews, POST /reviews/:id/retry): сначала месячный лимит тарифа,
 *   при исчерпании — пакетные кредиты; конкурентные запросы не пробивают ни то, ни другое;
 * - compensate() — атомарный возврат в исходный источник, вызывается воркером при FAILED.
 */
@Injectable()
export class UsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Лимит генераций в месяц для тарифа. Значения из env. */
  limitFor(plan: Plan): number {
    switch (plan) {
      case 'FREE':
        return this.config.get('LIMIT_FREE', { infer: true });
      case 'START':
        return this.config.get('LIMIT_START', { infer: true });
      case 'BUSINESS':
        return this.config.get('LIMIT_BUSINESS', { infer: true });
    }
  }

  /** Текущий период вида "2026-06" (UTC). */
  currentPeriod(now: Date = new Date()): string {
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  /**
   * Резервирует одну генерацию. Вызывать ВНУТРИ транзакции вместе с созданием
   * Review + Generation. Порядок списания (ADR-037): сначала месячный лимит
   * тарифа (UsageCounter), при исчерпании — атомарный декремент пакетных
   * кредитов (Company.packageCredits >= 1); если и там пусто —
   * AppException(402 LIMIT_EXCEEDED). Возвращает источник списания.
   *
   * Атомарность: условный UPDATE ... WHERE used < limit / packageCredits >= 1 —
   * БД сериализует конкурентные декременты на блокировке строки.
   */
  async reserve(
    tx: Prisma.TransactionClient,
    companyId: string,
    plan: Plan,
    period: string = this.currentPeriod(),
  ): Promise<UsageSource> {
    const limit = this.limitFor(plan);

    // Гарантируем существование строки счётчика периода (идемпотентно).
    await tx.usageCounter
      .upsert({
        where: { companyId_period: { companyId, period } },
        create: { companyId, period, used: 0 },
        update: {},
      })
      .catch((e: unknown) => {
        // P2002 — гонка двух upsert'ов на создании строки: строка уже есть, идём дальше.
        if (this.isUniqueViolation(e)) return;
        throw e;
      });

    const updated = await tx.$executeRaw`
      UPDATE "UsageCounter"
      SET "used" = "used" + 1
      WHERE "companyId" = ${companyId} AND "period" = ${period} AND "used" < ${limit}
    `;

    if (updated > 0) return 'PLAN';

    // Месячный лимит исчерпан — пробуем пакетные кредиты (атомарно: только
    // строки с packageCredits >= 1, конкуренция не уводит остаток в минус).
    const fromPackage = await tx.company.updateMany({
      where: { id: companyId, packageCredits: { gte: 1 } },
      data: { packageCredits: { decrement: 1 } },
    });
    if (fromPackage.count > 0) return 'PACKAGE';

    throw new AppException('LIMIT_EXCEEDED', 'Лимит генераций на этот месяц исчерпан', 402, {
      limit,
      period,
    });
  }

  /**
   * Компенсация резерва при FAILED-генерации: атомарный возврат в исходный
   * источник (ADR-037) — PLAN: декремент UsageCounter (не ниже 0),
   * PACKAGE: инкремент Company.packageCredits.
   * Вызывается воркером генерации вне транзакции резервирования.
   */
  async compensate(
    companyId: string,
    period: string,
    source: UsageSource = 'PLAN',
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    if (source === 'PACKAGE') {
      await tx.company.updateMany({
        where: { id: companyId },
        data: { packageCredits: { increment: 1 } },
      });
      return;
    }
    await tx.$executeRaw`
      UPDATE "UsageCounter"
      SET "used" = "used" - 1
      WHERE "companyId" = ${companyId} AND "period" = ${period} AND "used" > 0
    `;
  }

  /** Текущее использование за период — для счётчика лимита в UI. */
  async getUsage(
    companyId: string,
    plan: Plan,
    period: string = this.currentPeriod(),
  ): Promise<{ used: number; limit: number; period: string }> {
    const counter = await this.prisma.usageCounter.findUnique({
      where: { companyId_period: { companyId, period } },
    });
    return { used: counter?.used ?? 0, limit: this.limitFor(plan), period };
  }

  private isUniqueViolation(e: unknown): boolean {
    return (
      typeof e === 'object' &&
      e !== null &&
      'code' in e &&
      (e as { code?: unknown }).code === 'P2002'
    );
  }
}
