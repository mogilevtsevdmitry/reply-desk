import { AppException } from '../../common/app.exception';
import type { PrismaService } from '../../prisma/prisma.service';
import type { GenerationQueueService } from '../generation/generation-queue.service';
import type { UsageService } from '../usage/usage.service';
import { ReviewsService } from './reviews.service';

/**
 * Тесты создания отзыва: резервирование лимита в транзакции (ADR-002, ADR-037),
 * job после транзакции, 402 при исчерпании. Ретрая нет (ADR-042 отменил ADR-003):
 * повтор после FAILED — обычный POST /reviews с фронта.
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
