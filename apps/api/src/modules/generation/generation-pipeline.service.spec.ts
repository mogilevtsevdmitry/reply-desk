import type { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { join } from 'node:path';
import type { Env } from '../../config/env';
import type { PrismaService } from '../../prisma/prisma.service';
import { LlmInvalidOutputError, LlmProvider } from '../llm/llm.types';
import type { UsageService } from '../usage/usage.service';
import { GenerationPipelineService } from './generation-pipeline.service';

/**
 * Пайплайн воркера: ошибки LLM → компенсация лимита (ADR-002) → финальное
 * SSE-событие FAILED → удаление Review (ADR-042, упавшая генерация не сохраняется);
 * публикация переходов статуса в Redis pub/sub, фильтрация similarReviewIds.
 */

const JOB = { generationId: 'gen-1', reviewId: 'review-1', companyId: 'company-1', period: '2026-06' };

const VALID_PAYLOAD = {
  publicReplies: { soft: 's', neutral: 'n', confident: 'c', platformNotes: 'p' },
  internalTask: { what: 'w', probableCause: 'p', toCheck: ['x'], assigneeRole: 'Администратор' },
  classification: {
    category: 'SERVICE',
    severity: 3,
    isRepeat: true,
    similarReviewIds: ['candidate-1', 'evil-foreign-id'],
    fakeSuspicion: { flag: false, reason: '-' },
  },
  winback: { message: 'm', compensation: { type: 't', rationale: 'r' } },
};

interface Setup {
  service: GenerationPipelineService;
  prisma: {
    generation: { findUnique: jest.Mock; update: jest.Mock };
    review: { update: jest.Mock; deleteMany: jest.Mock };
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  usage: { compensate: jest.Mock };
  llm: { generateStructured: jest.Mock };
  redis: { publish: jest.Mock };
}

function setup(llmResult: () => Promise<{ data: unknown; tokensUsed: number }>): Setup {
  const prisma = {
    generation: {
      findUnique: jest.fn(async () => ({
        id: 'gen-1',
        status: 'PENDING',
        review: {
          id: 'review-1',
          companyId: 'company-1',
          source: 'YANDEX_MAPS',
          rating: 2,
          authorName: null,
          rawText: 'Текст отзыва',
          company: {
            id: 'company-1',
            name: 'Студия',
            niche: 'SALON',
            toneOfVoice: { tone: 'neutral', examples: [] },
          },
        },
      })),
      update: jest.fn(async () => ({})),
    },
    review: { update: jest.fn(async () => ({})), deleteMany: jest.fn(async () => ({ count: 1 })) },
    $queryRaw: jest.fn(async () => [
      { id: 'candidate-1', rawText: 'похожий', category: 'SERVICE', createdAt: new Date(), sim: 0.7 },
    ]),
    $transaction: jest.fn(async (ops: unknown[]) => ops),
  };
  const usage = { compensate: jest.fn(async () => undefined) };
  const llm = { generateStructured: jest.fn(llmResult) };
  const redis = { publish: jest.fn(async () => 1) };
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'SIMILARITY_THRESHOLD') return 0.3;
      if (key === 'PROMPTS_DIR') return join(__dirname, '../../../../../prompts');
      return undefined;
    }),
  };

  const service = new GenerationPipelineService(
    prisma as unknown as PrismaService,
    usage as unknown as UsageService,
    config as unknown as ConfigService<Env, true>,
    llm as unknown as LlmProvider,
    redis as unknown as Redis,
  );
  return { service, prisma, usage, llm, redis };
}

function publishedStatuses(redis: { publish: jest.Mock }): string[] {
  return redis.publish.mock.calls.map((c) => (JSON.parse(c[1] as string) as { status: string }).status);
}

describe('GenerationPipelineService — пайплайн воркера', () => {
  it('happy path: ANALYZING → GENERATING → DONE, чужие similarReviewIds отброшены', async () => {
    const { service, prisma, usage, redis } = setup(async () => ({
      data: VALID_PAYLOAD,
      tokensUsed: 500,
    }));

    await service.process(JOB);

    expect(publishedStatuses(redis)).toEqual(['ANALYZING', 'GENERATING', 'DONE']);
    expect(redis.publish.mock.calls.every((c) => c[0] === 'gen:gen-1')).toBe(true);

    // DONE-обновление: только подмножество кандидатов в similarReviewIds.
    const doneUpdate = prisma.generation.update.mock.calls.find(
      (c) => (c[0] as { data: { status?: string } }).data.status === 'DONE',
    );
    expect(doneUpdate).toBeDefined();
    const classification = (doneUpdate![0] as { data: { classification: { similarReviewIds: string[] } } })
      .data.classification;
    expect(classification.similarReviewIds).toEqual(['candidate-1']);

    // Review обновлён классификацией, компенсации нет.
    expect(prisma.review.update).toHaveBeenCalledWith({
      where: { id: 'review-1' },
      data: { category: 'SERVICE', severity: 3, isFakeSusp: false },
    });
    expect(usage.compensate).not.toHaveBeenCalled();
    expect(prisma.review.deleteMany).not.toHaveBeenCalled();
  });

  it('ошибка LLM → компенсация + SSE FAILED + удаление Review (ADR-042); статус FAILED в БД не пишется', async () => {
    const { service, prisma, usage, redis } = setup(async () => {
      throw new LlmInvalidOutputError('невалидный вывод');
    });

    await service.process(JOB);

    expect(publishedStatuses(redis)).toEqual(['ANALYZING', 'GENERATING', 'FAILED']);
    expect(usage.compensate).toHaveBeenCalledWith('company-1', '2026-06', 'PLAN');

    // Review удаляется (cascade удалит Generation); статус FAILED в БД не сохраняется.
    expect(prisma.review.deleteMany).toHaveBeenCalledWith({ where: { id: 'review-1' } });
    const failedStatusWrite = prisma.generation.update.mock.calls.find(
      (c) => (c[0] as { data: { status?: string } }).data.status === 'FAILED',
    );
    expect(failedStatusWrite).toBeUndefined();

    // Финальное событие содержит понятную ошибку без текста отзыва.
    const failedEvent = redis.publish.mock.calls
      .map((c) => JSON.parse(c[1] as string) as { status: string; error?: string })
      .find((e) => e.status === 'FAILED');
    expect(failedEvent?.error).toContain('некорректный результат');
    expect(failedEvent?.error).not.toContain('Текст отзыва');

    // Порядок: компенсация → публикация FAILED → удаление (событие уходит до удаления).
    const compensateOrder = usage.compensate.mock.invocationCallOrder[0]!;
    const publishFailedIdx = redis.publish.mock.calls.findIndex(
      (c) => (JSON.parse(c[1] as string) as { status: string }).status === 'FAILED',
    );
    const publishOrder = redis.publish.mock.invocationCallOrder[publishFailedIdx]!;
    const deleteOrder = prisma.review.deleteMany.mock.invocationCallOrder[0]!;
    expect(compensateOrder).toBeLessThan(publishOrder);
    expect(publishOrder).toBeLessThan(deleteOrder);
  });

  it('FAILED при списании из пакета → компенсация в источник PACKAGE (ADR-037)', async () => {
    const { service, prisma, usage } = setup(async () => {
      throw new LlmInvalidOutputError('невалидный вывод');
    });

    await service.process({ ...JOB, usageSource: 'PACKAGE' });

    expect(usage.compensate).toHaveBeenCalledWith('company-1', '2026-06', 'PACKAGE');
    expect(prisma.review.deleteMany).toHaveBeenCalledWith({ where: { id: 'review-1' } });
  });

  it('несуществующая генерация → job тихо пропускается без падения', async () => {
    const { service, prisma, redis } = setup(async () => ({ data: VALID_PAYLOAD, tokensUsed: 1 }));
    prisma.generation.findUnique.mockResolvedValue(null);

    await expect(service.process(JOB)).resolves.toBeUndefined();
    expect(redis.publish).not.toHaveBeenCalled();
  });
});
