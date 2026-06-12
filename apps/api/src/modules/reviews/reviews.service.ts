import { Injectable } from '@nestjs/common';
import type { Generation, Prisma, Review } from '@prisma/client';
import {
  ClassificationSchema,
  CreateReviewDto,
  CreateReviewResponse,
  GenerationDto,
  InternalTaskSchema,
  ListReviewsQuery,
  ListReviewsResponse,
  PublicRepliesSchema,
  RetryReviewResponse,
  ReviewWithGeneration,
  WinbackSchema,
} from '@replydesk/contracts';
import { AppException } from '../../common/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { GenerationQueueService } from '../generation/generation-queue.service';
import { UsageService } from '../usage/usage.service';

type ReviewWithGen = Review & { generation: Generation | null };

/**
 * Отзывы тенанта. Все запросы строго по companyId из JWT;
 * чужой/несуществующий id неразличимы → 404 (изоляция тенантов).
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly queue: GenerationQueueService,
  ) {}

  /**
   * POST /reviews: в ОДНОЙ транзакции — атомарное резервирование лимита (ADR-002)
   * + создание Review + Generation(PENDING); job в очередь — после фиксации транзакции.
   */
  async create(companyId: string, dto: CreateReviewDto): Promise<CreateReviewResponse> {
    const period = this.usage.currentPeriod();

    const result = await this.prisma.$transaction(async (tx) => {
      const company = await tx.company.findUnique({ where: { id: companyId } });
      if (!company) {
        throw new AppException('COMPANY_NOT_FOUND', 'Компания не найдена', 404);
      }
      const usageSource = await this.usage.reserve(tx, companyId, company.plan, period);
      const review = await tx.review.create({
        data: {
          companyId,
          source: dto.source,
          rating: dto.rating ?? null,
          authorName: dto.authorName ?? null,
          rawText: dto.rawText,
        },
      });
      const generation = await tx.generation.create({ data: { reviewId: review.id } });
      return { reviewId: review.id, generationId: generation.id, usageSource };
    });

    await this.queue.enqueue({
      generationId: result.generationId,
      reviewId: result.reviewId,
      companyId,
      period,
      usageSource: result.usageSource,
    });
    return { reviewId: result.reviewId, generationId: result.generationId };
  }

  /**
   * POST /reviews/:id/retry (ADR-003): только из FAILED (иначе 409),
   * заново резервирует лимит (402 при исчерпании), статус → PENDING, job в очередь.
   */
  async retry(companyId: string, reviewId: string): Promise<RetryReviewResponse> {
    const period = this.usage.currentPeriod();

    const result = await this.prisma.$transaction(async (tx) => {
      const review = await tx.review.findFirst({
        where: { id: reviewId, companyId },
        include: { generation: true, company: true },
      });
      if (!review || !review.generation) {
        throw new AppException('NOT_FOUND', 'Отзыв не найден', 404);
      }
      if (review.generation.status !== 'FAILED') {
        throw new AppException(
          'CONFLICT',
          'Повторить можно только неудавшуюся генерацию',
          409,
        );
      }
      const usageSource = await this.usage.reserve(tx, companyId, review.company.plan, period);
      await tx.generation.update({
        where: { id: review.generation.id },
        data: { status: 'PENDING', error: null },
      });
      return { generationId: review.generation.id, usageSource };
    });

    await this.queue.enqueue({
      generationId: result.generationId,
      reviewId,
      companyId,
      period,
      usageSource: result.usageSource,
    });
    return { generationId: result.generationId };
  }

  /** GET /reviews: фильтры source/category/severity/from/to + пагинация page/pageSize. */
  async list(companyId: string, query: ListReviewsQuery): Promise<ListReviewsResponse> {
    const where: Prisma.ReviewWhereInput = {
      companyId,
      ...(query.source !== undefined ? { source: query.source } : {}),
      ...(query.category !== undefined ? { category: query.category } : {}),
      ...(query.severity !== undefined ? { severity: query.severity } : {}),
      ...(query.from !== undefined || query.to !== undefined
        ? {
            createdAt: {
              ...(query.from !== undefined ? { gte: query.from } : {}),
              ...(query.to !== undefined ? { lte: query.to } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.review.findMany({
        where,
        include: { generation: true },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.review.count({ where }),
    ]);

    return { items: items.map((r) => this.toReviewWithGeneration(r)), total };
  }

  /** GET /reviews/:id → Review + Generation; чужой id → 404. */
  async getOne(companyId: string, reviewId: string): Promise<ReviewWithGeneration> {
    const review = await this.prisma.review.findFirst({
      where: { id: reviewId, companyId },
      include: { generation: true },
    });
    if (!review) {
      throw new AppException('NOT_FOUND', 'Отзыв не найден', 404);
    }
    return this.toReviewWithGeneration(review);
  }

  private toReviewWithGeneration(review: ReviewWithGen): ReviewWithGeneration {
    return {
      id: review.id,
      source: review.source,
      rating: review.rating,
      authorName: review.authorName,
      rawText: review.rawText,
      category: review.category,
      severity: review.severity,
      isFakeSusp: review.isFakeSusp,
      createdAt: review.createdAt.toISOString(),
      generation: review.generation ? this.toGenerationDto(review.generation) : null,
    };
  }

  private toGenerationDto(generation: Generation): GenerationDto {
    return {
      id: generation.id,
      reviewId: generation.reviewId,
      status: generation.status,
      publicReplies:
        generation.publicReplies !== null
          ? PublicRepliesSchema.parse(generation.publicReplies)
          : null,
      internalTask:
        generation.internalTask !== null
          ? InternalTaskSchema.parse(generation.internalTask)
          : null,
      classification:
        generation.classification !== null
          ? ClassificationSchema.parse(generation.classification)
          : null,
      winback: generation.winback !== null ? WinbackSchema.parse(generation.winback) : null,
      error: generation.error,
      tokensUsed: generation.tokensUsed,
      createdAt: generation.createdAt.toISOString(),
    };
  }
}
