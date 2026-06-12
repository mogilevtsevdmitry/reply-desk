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

/**
 * Ждёт удаления Review из БД (ADR-042: воркер удаляет отзыв при FAILED;
 * cascade удаляет Generation).
 */
export async function waitForReviewDeleted(
  app: INestApplication,
  reviewId: string,
  timeoutMs = 30_000,
): Promise<void> {
  const prisma = app.get(PrismaService);
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const review = await prisma.review.findUnique({
      where: { id: reviewId },
      select: { id: true },
    });
    if (!review) return;
    await sleep(200);
  }

  throw new Error(`Timeout: review ${reviewId} не удалён за ${timeoutMs}ms (ожидали FAILED → delete)`);
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
    await sleep(200);
  }

  throw new Error(
    `Timeout: generation ${generationId} не достигла статуса ${targetStatus} за ${timeoutMs}ms`,
  );
}

/**
 * Ждёт финального исхода: DONE — статус в БД; FAILED — запись удалена
 * воркером (ADR-042), возвращается строка 'FAILED'.
 */
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
    if (!gen) return 'FAILED'; // удалена при FAILED (ADR-042)
    if (gen.status === 'DONE') return gen.status;
    await sleep(200);
  }

  throw new Error(`Timeout: generation ${generationId} не завершилась за ${timeoutMs}ms`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
