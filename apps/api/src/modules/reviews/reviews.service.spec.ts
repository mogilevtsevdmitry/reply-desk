import type { GenStatus } from '@replydesk/contracts';
import { AppException } from '../../common/app.exception';
import type { PrismaService } from '../../prisma/prisma.service';
import type { GenerationQueueService } from '../generation/generation-queue.service';
import type { UsageService } from '../usage/usage.service';
import { ReviewsService } from './reviews.service';

/**
 * Тесты retry-логики (ADR-003) и создания отзыва: 409 для не-FAILED,
 * 404 для чужого id, повторное резервирование лимита, job после транзакции.
 */

const COMPANY_ID = 'company-1';
const PERIOD = '2026-06';

interface MockSetup {
  service: ReviewsService;
  tx: {
    company: { findUnique: jest.Mock };
    review: { findFirst: jest.Mock; create: jest.Mock };
    generation: { create: jest.Mock; update: jest.Mock };
  };
  usage: { reserve: jest.Mock; compensate: jest.Mock; currentPeriod: jest.Mock };
  queue: { enqueue: jest.Mock };
}

function setup(): MockSetup {
  const tx = {
    company: { findUnique: jest.fn() },
    review: { findFirst: jest.fn(), create: jest.fn() },
    generation: { create: jest.fn(), update: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  } as unknown as PrismaService;
  const usage = {
    reserve: jest.fn(async () => 'PLAN'),
    compensate: jest.fn(async () => undefined),
    currentPeriod: jest.fn(() => PERIOD),
  };
  const queue = { enqueue: jest.fn(async () => undefined) };

  const service = new ReviewsService(
    prisma,
    usage as unknown as UsageService,
    queue as unknown as GenerationQueueService,
  );
  return { service, tx, usage, queue };
}

function failedReview(status: GenStatus) {
  return {
    id: 'review-1',
    companyId: COMPANY_ID,
    generation: { id: 'gen-1', status },
    company: { id: COMPANY_ID, plan: 'FREE' },
  };
}

describe('ReviewsService.create — POST /reviews', () => {
  it('reserve + Review + Generation(PENDING) в транзакции, затем job в очередь', async () => {
    const { service, tx, usage, queue } = setup();
    tx.company.findUnique.mockResolvedValue({ id: COMPANY_ID, plan: 'FREE' });
    tx.review.create.mockResolvedValue({ id: 'review-1' });
    tx.generation.create.mockResolvedValue({ id: 'gen-1' });

    const result = await service.create(COMPANY_ID, {
      source: 'YANDEX_MAPS',
      authorName: 'Анна',
      rawText: 'Текст отзыва',
    });

    expect(result).toEqual({ reviewId: 'review-1', generationId: 'gen-1' });
    expect(usage.reserve).toHaveBeenCalledWith(tx, COMPANY_ID, 'FREE', PERIOD);
    expect(tx.review.create).toHaveBeenCalledWith({
      data: {
        companyId: COMPANY_ID,
        source: 'YANDEX_MAPS',
        rating: null,
        authorName: 'Анна',
        rawText: 'Текст отзыва',
      },
    });
    expect(tx.generation.create).toHaveBeenCalledWith({ data: { reviewId: 'review-1' } });
    expect(queue.enqueue).toHaveBeenCalledWith({
      generationId: 'gen-1',
      reviewId: 'review-1',
      companyId: COMPANY_ID,
      period: PERIOD,
      usageSource: 'PLAN',
    });
  });

  it('списание из пакета → usageSource=PACKAGE уходит в job (ADR-037)', async () => {
    const { service, tx, usage, queue } = setup();
    tx.company.findUnique.mockResolvedValue({ id: COMPANY_ID, plan: 'FREE' });
    tx.review.create.mockResolvedValue({ id: 'review-1' });
    tx.generation.create.mockResolvedValue({ id: 'gen-1' });
    usage.reserve.mockResolvedValue('PACKAGE');

    await service.create(COMPANY_ID, { source: 'OTHER', rawText: 'Текст' });

    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ usageSource: 'PACKAGE' }),
    );
  });

  it('authorName не передан → в Review сохраняется null', async () => {
    const { service, tx } = setup();
    tx.company.findUnique.mockResolvedValue({ id: COMPANY_ID, plan: 'FREE' });
    tx.review.create.mockResolvedValue({ id: 'review-1' });
    tx.generation.create.mockResolvedValue({ id: 'gen-1' });

    await service.create(COMPANY_ID, { source: 'OTHER', rawText: 'Текст' });

    expect(tx.review.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ authorName: null }),
    });
  });

  it('402 от reserve прерывает транзакцию: Review не создаётся, job не ставится', async () => {
    const { service, tx, usage, queue } = setup();
    tx.company.findUnique.mockResolvedValue({ id: COMPANY_ID, plan: 'FREE' });
    usage.reserve.mockRejectedValue(new AppException('LIMIT_EXCEEDED', 'Лимит', 402));

    await expect(
      service.create(COMPANY_ID, { source: 'OTHER', rawText: 'Текст' }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
    expect(tx.review.create).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});

describe('ReviewsService.retry — POST /reviews/:id/retry (ADR-003)', () => {
  it('FAILED → повторный reserve, статус PENDING, job в очередь', async () => {
    const { service, tx, usage, queue } = setup();
    tx.review.findFirst.mockResolvedValue(failedReview('FAILED'));

    const result = await service.retry(COMPANY_ID, 'review-1');

    expect(result).toEqual({ generationId: 'gen-1' });
    expect(usage.reserve).toHaveBeenCalledWith(tx, COMPANY_ID, 'FREE', PERIOD);
    expect(tx.generation.update).toHaveBeenCalledWith({
      where: { id: 'gen-1' },
      data: { status: 'PENDING', error: null },
    });
    expect(queue.enqueue).toHaveBeenCalledWith({
      generationId: 'gen-1',
      reviewId: 'review-1',
      companyId: COMPANY_ID,
      period: PERIOD,
      usageSource: 'PLAN',
    });
  });

  it.each<GenStatus>(['PENDING', 'ANALYZING', 'GENERATING', 'DONE'])(
    'статус %s → 409 CONFLICT, лимит не резервируется',
    async (status) => {
      const { service, tx, usage, queue } = setup();
      tx.review.findFirst.mockResolvedValue(failedReview(status));

      try {
        await service.retry(COMPANY_ID, 'review-1');
        fail('должен был бросить AppException');
      } catch (e) {
        expect(e).toBeInstanceOf(AppException);
        expect((e as AppException).code).toBe('CONFLICT');
        expect((e as AppException).getStatus()).toBe(409);
      }
      expect(usage.reserve).not.toHaveBeenCalled();
      expect(queue.enqueue).not.toHaveBeenCalled();
    },
  );

  it('чужой/несуществующий id → 404 NOT_FOUND (изоляция тенантов, не 403)', async () => {
    const { service, tx } = setup();
    tx.review.findFirst.mockResolvedValue(null);

    try {
      await service.retry(COMPANY_ID, 'review-foreign');
      fail('должен был бросить AppException');
    } catch (e) {
      expect(e).toBeInstanceOf(AppException);
      expect((e as AppException).code).toBe('NOT_FOUND');
      expect((e as AppException).getStatus()).toBe(404);
    }
    // Запрос обязан фильтровать по companyId из JWT.
    expect(tx.review.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'review-foreign', companyId: COMPANY_ID } }),
    );
  });

  it('402 при исчерпанном лимите: статус не сбрасывается, job не ставится', async () => {
    const { service, tx, usage, queue } = setup();
    tx.review.findFirst.mockResolvedValue(failedReview('FAILED'));
    usage.reserve.mockRejectedValue(new AppException('LIMIT_EXCEEDED', 'Лимит', 402));

    await expect(service.retry(COMPANY_ID, 'review-1')).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    });
    expect(tx.generation.update).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});
