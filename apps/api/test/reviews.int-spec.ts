/**
 * Интеграционные тесты: Reviews + лимиты (03-QA.md, секция Reviews + лимиты)
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './helpers/app-factory';
import {
  createReview,
  registerAndOnboard,
  uniqueEmail,
} from './helpers/api-helpers';
import {
  cleanDatabase,
  getUsageCounter,
  waitForGenerationDoneOrFailed,
  waitForGenerationStatus,
  waitForReviewDeleted,
} from './helpers/db-helpers';

describe('Reviews — интеграционные тесты', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(app);
  });

  // -------------------------------------------------------------------------
  // Валидация входных данных
  // -------------------------------------------------------------------------

  it('POST /reviews: пустой текст → 422', async () => {
    const user = await registerAndOnboard(app);

    await request(app.getHttpServer())
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${user.companyToken}`)
      .send({ source: 'YANDEX_MAPS', rawText: '' })
      .expect(422);
  });

  it('POST /reviews: текст > 4000 символов → 422', async () => {
    const user = await registerAndOnboard(app);
    const longText = 'А'.repeat(4001);

    await request(app.getHttpServer())
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${user.companyToken}`)
      .send({ source: 'YANDEX_MAPS', rawText: longText })
      .expect(422);
  });

  it('POST /reviews: неверный source → 422', async () => {
    const user = await registerAndOnboard(app);

    await request(app.getHttpServer())
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${user.companyToken}`)
      .send({ source: 'INVALID_SOURCE', rawText: 'Отличный сервис!' })
      .expect(422);
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('POST /reviews: happy path — 202, Generation PENDING, job в очереди', async () => {
    const user = await registerAndOnboard(app);

    const res = await request(app.getHttpServer())
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${user.companyToken}`)
      .send({ source: 'YANDEX_MAPS', rawText: 'Хорошее место, рекомендую!' })
      .expect(202);

    const body = res.body as { reviewId: string; generationId: string };
    expect(body.reviewId).toBeDefined();
    expect(body.generationId).toBeDefined();

    // Проверяем статус в БД
    const prisma = app.get(PrismaService);
    const gen = await prisma.generation.findUnique({ where: { id: body.generationId } });
    // Может уже переходить в ANALYZING, но точно не DONE/FAILED сразу
    expect(gen).not.toBeNull();
    expect(['PENDING', 'ANALYZING', 'GENERATING', 'DONE']).toContain(gen!.status);
  });

  it('authorName сохраняется в Review и возвращается в GET /reviews/:id', async () => {
    const user = await registerAndOnboard(app);

    const { reviewId, generationId } = await createReview(
      app,
      user.companyToken,
      'Хороший мастер, доволен результатом.',
      { authorName: 'Иван Петров' },
    );

    // Ждём завершения генерации
    await waitForGenerationDoneOrFailed(app, generationId);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/reviews/${reviewId}`)
      .set('Authorization', `Bearer ${user.companyToken}`)
      .expect(200);

    const body = res.body as { authorName: string };
    expect(body.authorName).toBe('Иван Петров');
  });

  // -------------------------------------------------------------------------
  // Лимиты
  // -------------------------------------------------------------------------

  it('лимит FREE=10: 10 успешных + 11-я → 402 LIMIT_EXCEEDED', async () => {
    const user = await registerAndOnboard(app);

    // Создаём 10 отзывов ПОСЛЕДОВАТЕЛЬНО — гарантируем, что все 10 пройдут
    for (let i = 0; i < 10; i++) {
      await request(app.getHttpServer())
        .post('/api/v1/reviews')
        .set('Authorization', `Bearer ${user.companyToken}`)
        .send({ source: 'YANDEX_MAPS', rawText: `Отзыв номер ${i + 1}` })
        .expect(202);
    }

    // 11-я попытка
    const overflow = await request(app.getHttpServer())
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${user.companyToken}`)
      .send({ source: 'YANDEX_MAPS', rawText: 'Одиннадцатый отзыв' });

    expect(overflow.status).toBe(402);
    expect((overflow.body as { code: string }).code).toBe('LIMIT_EXCEEDED');
  }, 60_000);

  it('FAILED → отзыв удалён из БД, UsageCounter компенсирован (ADR-042, [[FAKE:NETWORK]])', async () => {
    const user = await registerAndOnboard(app);
    const prisma = app.get(PrismaService);

    // Получаем текущий период
    const now = new Date();
    const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

    const usedBefore = await getUsageCounter(app, user.companyId, period);

    // Создаём отзыв с маркером NETWORK → воркер кинет LlmNetworkError →
    // компенсация → SSE FAILED → удаление Review (cascade удаляет Generation)
    const { reviewId, generationId } = await createReview(
      app,
      user.companyToken,
      'Плохое обслуживание [[FAKE:NETWORK]]',
    );

    // После POST лимит зарезервирован (+1)
    const usedAfterPost = await getUsageCounter(app, user.companyId, period);
    expect(usedAfterPost).toBe(usedBefore + 1);

    // Ждём удаления отзыва воркером
    await waitForReviewDeleted(app, reviewId);

    // Generation удалена каскадом
    const gen = await prisma.generation.findUnique({ where: { id: generationId } });
    expect(gen).toBeNull();

    // Лимит компенсирован (вернулся к начальному)
    const usedAfterFailed = await getUsageCounter(app, user.companyId, period);
    expect(usedAfterFailed).toBe(usedBefore);

    // GET /reviews/:id → 404, в истории отзыва нет
    await request(app.getHttpServer())
      .get(`/api/v1/reviews/${reviewId}`)
      .set('Authorization', `Bearer ${user.companyToken}`)
      .expect(404);
  });

  // -------------------------------------------------------------------------
  // Конкурентность
  // -------------------------------------------------------------------------

  it('конкурентность: 5 параллельных POST при остатке лимита 1 → ровно одна 202, остальные 402', async () => {
    const user = await registerAndOnboard(app);

    // Расходуем 9 из 10 лимита последовательно (чтобы остаток был ровно 1)
    for (let i = 0; i < 9; i++) {
      await request(app.getHttpServer())
        .post('/api/v1/reviews')
        .set('Authorization', `Bearer ${user.companyToken}`)
        .send({ source: 'YANDEX_MAPS', rawText: `Заполняем лимит ${i + 1}` })
        .expect(202);
    }

    // 5 параллельных запросов при остатке 1
    const parallel = Array.from({ length: 5 }, () =>
      request(app.getHttpServer())
        .post('/api/v1/reviews')
        .set('Authorization', `Bearer ${user.companyToken}`)
        .send({ source: 'YANDEX_MAPS', rawText: 'Конкурентный отзыв' }),
    );

    const results = await Promise.all(parallel);
    const successCount = results.filter((r) => r.status === 202).length;
    const failedCount = results.filter((r) => r.status === 402).length;

    expect(successCount).toBe(1);
    expect(failedCount).toBe(4);
  }, 60_000);

  // -------------------------------------------------------------------------
  // Повтор после FAILED (ADR-042: ретрай-эндпоинта нет, повтор — новый POST)
  // -------------------------------------------------------------------------

  it('эндпоинт POST /reviews/:id/retry удалён → 404 (ADR-042 отменил ADR-003)', async () => {
    const user = await registerAndOnboard(app);

    const { reviewId } = await createReview(
      app,
      user.companyToken,
      'Хороший сервис, всё понравилось.',
    );

    await request(app.getHttpServer())
      .post(`/api/v1/reviews/${reviewId}/retry`)
      .set('Authorization', `Bearer ${user.companyToken}`)
      .expect(404);
  });

  it('повторная отправка того же текста после FAILED не находит удалённый отзыв в trgm-кандидатах', async () => {
    const user = await registerAndOnboard(app);
    const prisma = app.get(PrismaService);

    const baseText =
      'Запись потерялась, администратор нагрубил, ждали мастера сорок минут впустую.';

    // 1. Первая попытка падает: маркер сетевой ошибки → FAILED → Review удалён
    const failedAttempt = await createReview(
      app,
      user.companyToken,
      `${baseText} [[FAKE:NETWORK]]`,
    );
    await waitForReviewDeleted(app, failedAttempt.reviewId);

    // 2. Повтор того же текста (без маркера) → DONE
    const retryAttempt = await createReview(app, user.companyToken, baseText);
    await waitForGenerationStatus(app, retryAttempt.generationId, 'DONE');

    // Упавшая попытка не попала в похожие: её нет в БД, similarReviewIds пуст
    const gen = await prisma.generation.findUnique({
      where: { id: retryAttempt.generationId },
    });
    const classification = gen!.classification as {
      isRepeat: boolean;
      similarReviewIds: string[];
    };
    expect(classification.similarReviewIds).not.toContain(failedAttempt.reviewId);
    expect(classification.similarReviewIds).toHaveLength(0);

    // В истории ровно один отзыв — успешный
    const list = await request(app.getHttpServer())
      .get('/api/v1/reviews')
      .set('Authorization', `Bearer ${user.companyToken}`)
      .expect(200);
    expect((list.body as { total: number }).total).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Изоляция тенантов
  // -------------------------------------------------------------------------

  it('изоляция тенантов: пользователь A не читает review пользователя B → 404', async () => {
    const userA = await registerAndOnboard(app, { email: uniqueEmail() });
    const userB = await registerAndOnboard(app, { email: uniqueEmail() });

    // A создаёт отзыв
    const { reviewId } = await createReview(
      app,
      userA.companyToken,
      'Отзыв пользователя A.',
    );

    // B пытается прочитать отзыв A
    const res = await request(app.getHttpServer())
      .get(`/api/v1/reviews/${reviewId}`)
      .set('Authorization', `Bearer ${userB.companyToken}`)
      .expect(404);

    expect((res.body as { code: string }).code).toBe('NOT_FOUND');
  });
});
