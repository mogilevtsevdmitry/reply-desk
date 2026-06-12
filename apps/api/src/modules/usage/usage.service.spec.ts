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
  /** Остаток пакетных кредитов компании (ADR-037). */
  packageCredits?: number;
}

/** Эмуляция Prisma TransactionClient поверх in-memory счётчика. */
function makeTx(store: FakeCounterStore): Prisma.TransactionClient {
  return {
    company: {
      // Атомарный декремент/инкремент packageCredits (порядок списания, ADR-037)
      updateMany: jest.fn(
        async (args: {
          where: { packageCredits?: { gte: number } };
          data: { packageCredits: { decrement?: number; increment?: number } };
        }) => {
          const credits = store.packageCredits ?? 0;
          if (args.data.packageCredits.decrement) {
            if (credits >= (args.where.packageCredits?.gte ?? 1)) {
              store.packageCredits = credits - args.data.packageCredits.decrement;
              return { count: 1 };
            }
            return { count: 0 };
          }
          store.packageCredits = credits + (args.data.packageCredits.increment ?? 0);
          return { count: 1 };
        },
      ),
    },
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

  it('резервирует генерацию из лимита тарифа, пока он не исчерпан (source=PLAN)', async () => {
    const store: FakeCounterStore = { used: 0, exists: false };
    const tx = makeTx(store);

    await expect(service.reserve(tx, 'c1', 'FREE', '2026-06')).resolves.toBe('PLAN');
    expect(store.used).toBe(1);
  });

  it('бросает 402 LIMIT_EXCEEDED при исчерпанном лимите и пустом пакете', async () => {
    const store: FakeCounterStore = { used: 10, exists: true, packageCredits: 0 };
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

  it('compensate(PLAN) уменьшает счётчик, но не ниже нуля', async () => {
    const store: FakeCounterStore = { used: 1, exists: true };
    const tx = makeTx(store);

    await service.compensate('c1', '2026-06', 'PLAN', tx);
    expect(store.used).toBe(0);

    await service.compensate('c1', '2026-06', 'PLAN', tx);
    expect(store.used).toBe(0); // не уходит в минус
  });

  describe('порядок списания: лимит тарифа → пакет → 402 (ADR-037)', () => {
    it('при исчерпанном лимите списывает из пакета (source=PACKAGE)', async () => {
      const store: FakeCounterStore = { used: 10, exists: true, packageCredits: 3 };
      const tx = makeTx(store);

      await expect(service.reserve(tx, 'c1', 'FREE', '2026-06')).resolves.toBe('PACKAGE');
      expect(store.used).toBe(10); // лимит не тронут
      expect(store.packageCredits).toBe(2);
    });

    it('пока лимит не исчерпан — пакет не трогается', async () => {
      const store: FakeCounterStore = { used: 9, exists: true, packageCredits: 5 };
      const tx = makeTx(store);

      await expect(service.reserve(tx, 'c1', 'FREE', '2026-06')).resolves.toBe('PLAN');
      expect(store.packageCredits).toBe(5);
    });

    it('исчерпаны и лимит, и пакет → 402, остатки не уходят в минус', async () => {
      const store: FakeCounterStore = { used: 10, exists: true, packageCredits: 0 };
      const tx = makeTx(store);

      await expect(service.reserve(tx, 'c1', 'FREE', '2026-06')).rejects.toMatchObject({
        code: 'LIMIT_EXCEEDED',
      });
      expect(store.used).toBe(10);
      expect(store.packageCredits).toBe(0);
    });

    it('конкурентность на последнем пакетном кредите: ровно один успех', async () => {
      const store: FakeCounterStore = { used: 10, exists: true, packageCredits: 1 };
      const tx = makeTx(store);

      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => service.reserve(tx, 'c1', 'FREE', '2026-06')),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(store.packageCredits).toBe(0);
    });

    it('compensate(PACKAGE) возвращает кредит в пакет, а не в счётчик', async () => {
      const store: FakeCounterStore = { used: 10, exists: true, packageCredits: 0 };
      const tx = makeTx(store);

      await service.compensate('c1', '2026-06', 'PACKAGE', tx);
      expect(store.packageCredits).toBe(1);
      expect(store.used).toBe(10); // счётчик лимита не тронут
    });
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
