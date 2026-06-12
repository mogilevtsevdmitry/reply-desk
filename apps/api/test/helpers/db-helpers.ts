/**
 * Утилиты для работы с БД в интеграционных тестах.
 */
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';

/** Очищает все данные в БД (для изоляции тестов). */
export async function cleanDatabase(app: INestApplication): Promise<void> {
  const prisma = app.get(PrismaService);
  // Используем raw SQL TRUNCATE с каскадом — надёжнее цепочки deleteMany с FK
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "Generation", "UsageCounter", "Review", "RefreshToken", "PaymentTransaction", "Subscription", "User", "Company" RESTART IDENTITY CASCADE`,
  );
}

/** Возвращает UsageCounter для companyId+period. */
export async function getUsageCounter(
  app: INestApplication,
  companyId: string,
  period: string,
): Promise<number> {
  const prisma = app.get(PrismaService);
  const counter = await prisma.usageCounter.findUnique({
    where: { companyId_period: { companyId, period } },
  });
  return counter?.used ?? 0;
}

/** Ждёт пока Generation достигнет целевого статуса (поллинг БД). */
export async function waitForGenerationStatus(
  app: INestApplication,
  generationId: string,
  targetStatus: string,
  timeoutMs = 30_000,
): Promise<void> {
  const prisma = app.get(PrismaService);
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const gen = await prisma.generation.findUnique({
      where: { id: generationId },
      select: { status: true },
    });
    if (gen?.status === targetStatus) return;
    if (gen?.status === 'FAILED' && targetStatus !== 'FAILED') {
      throw new Error(`Generation ${generationId} упала со статусом FAILED, ожидали ${targetStatus}`);
    }
    await sleep(200);
  }

  throw new Error(
    `Timeout: generation ${generationId} не достигла статуса ${targetStatus} за ${timeoutMs}ms`,
  );
}

/** Ждёт одного из двух финальных статусов. */
export async function waitForGenerationDoneOrFailed(
  app: INestApplication,
  generationId: string,
  timeoutMs = 30_000,
): Promise<string> {
  const prisma = app.get(PrismaService);
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const gen = await prisma.generation.findUnique({
      where: { id: generationId },
      select: { status: true },
    });
    if (gen?.status === 'DONE' || gen?.status === 'FAILED') return gen.status;
    await sleep(200);
  }

  throw new Error(`Timeout: generation ${generationId} не завершилась за ${timeoutMs}ms`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
