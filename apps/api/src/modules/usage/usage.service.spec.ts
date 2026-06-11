import type { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { AppException } from '../../common/app.exception';
import type { Env } from '../../config/env';
import type { PrismaService } from '../../prisma/prisma.service';
import { UsageService } from './usage.service';

/**
 * Тесты модели «резервирование» (ADR-002).
 * БД мокается: in-memory счётчик эмулирует атомарный условный UPDATE —
 * на уровне логики проверяем, что конкурентные reserve() не пробивают лимит.
 */

const ENV = { LIMIT_FREE: 10, LIMIT_START: 100, LIMIT_BUSINESS: 1000 };

function makeConfig(): ConfigService<Env, true> {
  return {
    get: jest.fn((key: keyof typeof ENV) => ENV[key]),
  } as unknown as ConfigService<Env, true>;
}

interface FakeCounterStore {
  used: number;
  exists: boolean;
}

/** Эмуляция Prisma TransactionClient поверх in-memory счётчика. */
function makeTx(store: FakeCounterStore): Prisma.TransactionClient {
  return {
    usageCounter: {
      upsert: jest.fn(async () => {
        store.exists = true;
        return { id: 'uc1', companyId: 'c1', period: '2026-06', used: store.used };
      }),
    },
    // Условный UPDATE ... WHERE used < limit: атомарность БД эмулируется
    // синхронной проверкой+инкрементом (event loop не прерывает синхронный блок).
    $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      if (sql.includes('"used" + 1')) {
        const limit = values[2] as number;
        if (store.exists && store.used < limit) {
          store.used += 1;
          return 1;
        }
        return 0;
      }
      if (sql.includes('"used" - 1')) {
        if (store.exists && store.used > 0) {
          store.used -= 1;
          return 1;
        }
        return 0;
      }
      throw new Error(`Неожиданный SQL в моке: ${sql}`);
    }),
  } as unknown as Prisma.TransactionClient;
}

describe('UsageService — резервирование лимита (ADR-002)', () => {
  let service: UsageService;

  beforeEach(() => {
    service = new UsageService({} as unknown as PrismaService, makeConfig());
  });

  it('резервирует генерацию, пока лимит не исчерпан', async () => {
    const store: FakeCounterStore = { used: 0, exists: false };
    const tx = makeTx(store);

    await expect(service.reserve(tx, 'c1', 'FREE', '2026-06')).resolves.toBeUndefined();
    expect(store.used).toBe(1);
  });

  it('бросает 402 LIMIT_EXCEEDED при исчерпанном лимите', async () => {
    const store: FakeCounterStore = { used: 10, exists: true };
    const tx = makeTx(store);

    try {
      await service.reserve(tx, 'c1', 'FREE', '2026-06');
      fail('должен был бросить AppException');
    } catch (e) {
      expect(e).toBeInstanceOf(AppException);
      const err = e as AppException;
      expect(err.code).toBe('LIMIT_EXCEEDED');
      expect(err.getStatus()).toBe(402);
    }
    expect(store.used).toBe(10); // счётчик не пробит
  });

  it('конкурентность: 5 параллельных reserve при остатке 1 → ровно один успех', async () => {
    const store: FakeCounterStore = { used: 9, exists: true }; // FREE=10, остаток 1
    const tx = makeTx(store);

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => service.reserve(tx, 'c1', 'FREE', '2026-06')),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(4);
    expect(store.used).toBe(10); // ни одной лишней брони
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(AppException);
      expect(((r as PromiseRejectedResult).reason as AppException).code).toBe('LIMIT_EXCEEDED');
    }
  });

  it('compensate уменьшает счётчик, но не ниже нуля', async () => {
    const store: FakeCounterStore = { used: 1, exists: true };
    const tx = makeTx(store);

    await service.compensate('c1', '2026-06', tx);
    expect(store.used).toBe(0);

    await service.compensate('c1', '2026-06', tx);
    expect(store.used).toBe(0); // не уходит в минус
  });

  it('лимиты тарифов берутся из env: FREE=10, START=100, BUSINESS=1000', () => {
    expect(service.limitFor('FREE')).toBe(10);
    expect(service.limitFor('START')).toBe(100);
    expect(service.limitFor('BUSINESS')).toBe(1000);
  });

  it('currentPeriod возвращает "YYYY-MM" в UTC', () => {
    expect(service.currentPeriod(new Date(Date.UTC(2026, 5, 11)))).toBe('2026-06');
    expect(service.currentPeriod(new Date(Date.UTC(2026, 0, 1)))).toBe('2026-01');
  });
});
