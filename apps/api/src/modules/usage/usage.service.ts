import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Plan, Prisma } from '@prisma/client';
import { AppException } from '../../common/app.exception';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Лимиты генераций по модели «резервирование» (ADR-002):
 * - reserve() — атомарный инкремент UsageCounter внутри транзакции вызывающего
 *   (POST /reviews, POST /reviews/:id/retry): конкурентные запросы не пробивают лимит;
 * - compensate() — атомарный декремент (не ниже 0), вызывается воркером при FAILED.
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
   * Review + Generation. Бросает AppException(402 LIMIT_EXCEEDED), если лимит исчерпан.
   *
   * Атомарность: условный UPDATE ... WHERE used < limit — БД сериализует
   * конкурентные инкременты на блокировке строки; «победит» ровно остаток лимита.
   */
  async reserve(
    tx: Prisma.TransactionClient,
    companyId: string,
    plan: Plan,
    period: string = this.currentPeriod(),
  ): Promise<void> {
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

    if (updated === 0) {
      throw new AppException('LIMIT_EXCEEDED', 'Лимит генераций на этот месяц исчерпан', 402, {
        limit,
        period,
      });
    }
  }

  /**
   * Компенсация резерва при FAILED-генерации: атомарный декремент, не ниже 0.
   * Вызывается воркером генерации (задача 2.2) вне транзакции резервирования.
   */
  async compensate(
    companyId: string,
    period: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
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
