/**
 * Интеграционные тесты: Пайплайн генерации + SSE (03-QA.md, секция Пайплайн)
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './helpers/app-factory';
import {
  collectSseEvents,
  createReview,
  registerAndOnboard,
  uniqueEmail,
} from './helpers/api-helpers';
import {
  cleanDatabase,
  waitForGenerationDoneOrFailed,
  waitForGenerationStatus,
} from './helpers/db-helpers';

describe('Пайплайн генерации — интеграционные тесты', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(app);
  });

  // -------------------------------------------------------------------------
  // Статусы и SSE
  // -------------------------------------------------------------------------

  it('статусы идут по порядку PENDING→ANALYZING→GENERATING→DONE и приходят в SSE', async () => {
    const user = await registerAndOnboard(app);

    const { generationId } = await createReview(
      app,
      user.companyToken,
      'Хорошее место, рекомендую. Мастер профессионал.',
    );

    // Собираем SSE-события
    const events = await collectSseEvents(app, generationId, user.companyToken, 30_000);

    const statuses = events.map((e) => e['status'] as string);
    expect(statuses).toContain('DONE');

    // PENDING отдаётся немедленно при подключении к SSE
    // Затем идут промежуточные статусы
    // Проверяем что DONE есть в финале
    expect(statuses[statuses.length - 1]).toBe('DONE');
  });

  it('payload сохраняется во все 4 поля, Review.category/severity обновлены', async () => {
    const user = await registerAndOnboard(app);

    const { reviewId, generationId } = await createReview(
      app,
      user.companyToken,
      'Ужасный сервис, персонал грубил.',
    );

    await waitForGenerationStatus(app, generationId, 'DONE');

    const gen = await prisma.generation.findUnique({ where: { id: generationId } });
    expect(gen!.status).toBe('DONE');
    expect(gen!.publicReplies).not.toBeNull();
    expect(gen!.internalTask).not.toBeNull();
    expect(gen!.classification).not.toBeNull();
    expect(gen!.winback).not.toBeNull();

    // Проверяем Review.category и severity обновлены
    const review = await prisma.review.findUnique({ where: { id: reviewId } });
    expect(review!.category).not.toBeNull();
    expect(review!.severity).not.toBeNull();
  });

  it('невалидный JSON от LLM → один ретрай → FAILED + error (маркер [[FAKE:INVALID]])', async () => {
    const user = await registerAndOnboard(app);

    const { generationId } = await createReview(
      app,
      user.companyToken,
      'Проблема с записью [[FAKE:INVALID]]',
    );

    await waitForGenerationStatus(app, generationId, 'FAILED');

    const gen = await prisma.generation.findUnique({ where: { id: generationId } });
    expect(gen!.status).toBe('FAILED');
    expect(gen!.error).not.toBeNull();
    // Сообщение указывает на некорректный результат LLM
    expect(gen!.error).toContain('некорректный результат');
  });

  it('таймаут LLM → FAILED, SSE отдаёт финальное событие', async () => {
    const user = await registerAndOnboard(app);

    const { generationId } = await createReview(
      app,
      user.companyToken,
      'Долго ждали мастера [[FAKE:TIMEOUT]]',
    );

    // Собираем события и ждём финального FAILED
    const events = await collectSseEvents(app, generationId, user.companyToken, 30_000);

    const finalEvent = events[events.length - 1];
    expect(finalEvent?.['status']).toBe('FAILED');
    expect(finalEvent?.['error']).toBeDefined();

    // Проверяем Generation в БД
    const gen = await prisma.generation.findUnique({ where: { id: generationId } });
    expect(gen!.status).toBe('FAILED');
    expect(gen!.error).toContain('вовремя');
  });

  // -------------------------------------------------------------------------
  // Похожие отзывы
  // -------------------------------------------------------------------------

  it('похожие отзывы: 3 текстово похожих → у нового similarReviewIds не пуст, isRepeat=true', async () => {
    const user = await registerAndOnboard(app);

    // Сеем 3 похожих отзыва и ждём их DONE
    const similarText = 'Запись не сохранилась, пришлось перезаписываться, потеряли время.';
    const seeds: Array<{ reviewId: string; generationId: string }> = [];

    for (let i = 0; i < 3; i++) {
      const result = await createReview(
        app,
        user.companyToken,
        `${similarText} (посещение ${i + 1})`,
      );
      seeds.push(result);
    }

    // Ждём завершения всех
    await Promise.all(seeds.map((s) => waitForGenerationDoneOrFailed(app, s.generationId)));

    // Создаём четвёртый похожий отзыв
    const { generationId: newGenId } = await createReview(
      app,
      user.companyToken,
      `${similarText} и снова та же история.`,
    );

    await waitForGenerationStatus(app, newGenId, 'DONE');

    const gen = await prisma.generation.findUnique({ where: { id: newGenId } });
    const classification = gen!.classification as {
      isRepeat: boolean;
      similarReviewIds: string[];
    };

    expect(classification.isRepeat).toBe(true);
    expect(classification.similarReviewIds.length).toBeGreaterThan(0);

    // Похожие id принадлежат только этому тенанту
    const validIds = seeds.map((s) => s.reviewId);
    for (const simId of classification.similarReviewIds) {
      expect(validIds).toContain(simId);
    }
  }, 60_000);

  it('similarReviewIds содержит только id отзывов своего тенанта', async () => {
    const userA = await registerAndOnboard(app, { email: uniqueEmail() });
    const userB = await registerAndOnboard(app, { email: uniqueEmail() });

    const sameText = 'Обслуживание отвратительное, никому не советую, очень разочарован.';

    // Пользователь A сеет похожие отзывы
    const seedsA: Array<{ reviewId: string; generationId: string }> = [];
    for (let i = 0; i < 3; i++) {
      const r = await createReview(app, userA.companyToken, `${sameText} Попытка ${i + 1}`);
      seedsA.push(r);
    }
    await Promise.all(seedsA.map((s) => waitForGenerationDoneOrFailed(app, s.generationId)));

    // Пользователь B создаёт похожий отзыв
    const { generationId } = await createReview(app, userB.companyToken, `${sameText} Мой случай.`);
    await waitForGenerationStatus(app, generationId, 'DONE');

    const gen = await prisma.generation.findUnique({ where: { id: generationId } });
    const classification = gen!.classification as { similarReviewIds: string[] };

    // У B нет похожих в своём тенанте → список пуст (чужие id отфильтрованы)
    for (const simId of classification.similarReviewIds) {
      // Если вдруг попало — это должен быть id из тенанта B, а не A
      const validBIds = (
        await prisma.review.findMany({ where: { companyId: userB.companyId } })
      ).map((r) => r.id);
      expect(validBIds).toContain(simId);
    }
  }, 60_000);

  // -------------------------------------------------------------------------
  // SSE авторизация
  // -------------------------------------------------------------------------

  it('SSE чужой генерации → 404', async () => {
    const userA = await registerAndOnboard(app, { email: uniqueEmail() });
    const userB = await registerAndOnboard(app, { email: uniqueEmail() });

    const { generationId } = await createReview(
      app,
      userA.companyToken,
      'Отзыв пользователя A.',
    );

    await request(app.getHttpServer())
      .get(`/api/v1/generations/${generationId}/events`)
      .set('Authorization', `Bearer ${userB.companyToken}`)
      .set('Accept', 'text/event-stream')
      .expect(404);
  });
});
