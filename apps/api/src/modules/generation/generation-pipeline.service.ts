import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import {
  GenerationEvent,
  GenerationPayloadSchema,
  GenStatus,
  ToneOfVoice,
  ToneOfVoiceSchema,
} from '@replydesk/contracts';
import type { Redis } from 'ioredis';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS } from '../../redis/redis.module';
import {
  LLM_PROVIDER,
  LlmInvalidOutputError,
  LlmNetworkError,
  LlmProvider,
  LlmTimeoutError,
} from '../llm/llm.types';
import { UsageService } from '../usage/usage.service';
import type { GenerationJobData } from './generation-queue.service';
import { genChannel } from './generation.events';
import { sanitizeSimilarReviewIds } from './payload-validation';
import {
  buildSystemPrompt,
  buildUserPrompt,
  resolvePromptsDir,
  SimilarCandidate,
} from './prompt-builder';

/** Бюджет ответа модели: 4 блока пакета свободно укладываются. */
const MAX_OUTPUT_TOKENS = 4096;

interface SimilarRow {
  id: string;
  rawText: string;
  category: string | null;
  createdAt: Date;
  sim: number;
}

/**
 * Пайплайн генерации (docs/02-DEVELOPER.md, раздел 3): ANALYZING → pg_trgm-поиск
 * похожих → GENERATING → сборка промпта → один generateStructured → валидация
 * similarReviewIds → DONE. Ошибка → FAILED + error + компенсация лимита (ADR-002).
 * Каждый переход статуса публикуется в Redis pub/sub канал gen:{id}.
 */
@Injectable()
export class GenerationPipelineService {
  private readonly logger = new Logger(GenerationPipelineService.name);
  private promptsDir: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly config: ConfigService<Env, true>,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async process(job: GenerationJobData): Promise<void> {
    // Тексты отзывов НЕ логируются — только id.
    this.logger.log(`Генерация ${job.generationId} (review ${job.reviewId}): старт`);

    const generation = await this.prisma.generation.findUnique({
      where: { id: job.generationId },
      include: { review: { include: { company: true } } },
    });
    if (!generation) {
      this.logger.warn(`Генерация ${job.generationId} не найдена — job пропущен`);
      return;
    }

    const review = generation.review;
    const company = review.company;

    try {
      await this.setStatus(generation.id, 'ANALYZING');

      const candidates = await this.findSimilar(company.id, review.id, review.rawText);

      await this.setStatus(generation.id, 'GENERATING');

      const toneOfVoice = this.parseToneOfVoice(company.toneOfVoice);
      const system = buildSystemPrompt({
        promptsDir: this.getPromptsDir(),
        niche: company.niche,
        source: review.source,
        companyName: company.name,
        toneOfVoice,
        candidates,
      });
      const user = buildUserPrompt({
        source: review.source,
        rating: review.rating,
        authorName: review.authorName,
        rawText: review.rawText,
      });

      const { data, tokensUsed } = await this.llm.generateStructured({
        system,
        user,
        schema: GenerationPayloadSchema,
        maxTokens: MAX_OUTPUT_TOKENS,
      });

      const payload = sanitizeSimilarReviewIds(
        data,
        candidates.map((c) => c.id),
      );

      await this.prisma.$transaction([
        this.prisma.generation.update({
          where: { id: generation.id },
          data: {
            status: 'DONE',
            publicReplies: payload.publicReplies as Prisma.InputJsonObject,
            internalTask: payload.internalTask as Prisma.InputJsonObject,
            classification: payload.classification as Prisma.InputJsonObject,
            winback: payload.winback as Prisma.InputJsonObject,
            tokensUsed,
            error: null,
          },
        }),
        this.prisma.review.update({
          where: { id: review.id },
          data: {
            category: payload.classification.category,
            severity: payload.classification.severity,
            isFakeSusp: payload.classification.fakeSuspicion.flag,
          },
        }),
      ]);

      await this.publish(generation.id, { status: 'DONE', payload });
      this.logger.log(`Генерация ${generation.id}: DONE (tokensUsed=${tokensUsed})`);
    } catch (e) {
      const message = this.toUserError(e);
      this.logger.error(
        `Генерация ${generation.id}: FAILED — ${e instanceof Error ? e.message : String(e)}`,
      );
      await this.prisma.generation.update({
        where: { id: generation.id },
        data: { status: 'FAILED', error: message },
      });
      // Компенсация резерва лимита (ADR-002) — в период резервирования из job.
      await this.usage.compensate(job.companyId, job.period);
      await this.publish(generation.id, { status: 'FAILED', error: message });
    }
  }

  /** pg_trgm-поиск похожих: строго параметризованный запрос, только свой тенант (ADR-001). */
  private async findSimilar(
    companyId: string,
    reviewId: string,
    rawText: string,
  ): Promise<SimilarCandidate[]> {
    const threshold = this.config.get('SIMILARITY_THRESHOLD', { infer: true });
    const rows = await this.prisma.$queryRaw<SimilarRow[]>`
      SELECT id, "rawText", category::text AS category, "createdAt",
             similarity("rawText", ${rawText}) AS sim
      FROM "Review"
      WHERE "companyId" = ${companyId}
        AND id != ${reviewId}
        AND similarity("rawText", ${rawText}) > ${threshold}
      ORDER BY sim DESC
      LIMIT 5
    `;
    return rows.map((r) => ({
      id: r.id,
      rawText: r.rawText,
      category: r.category,
      createdAt: r.createdAt,
    }));
  }

  private async setStatus(generationId: string, status: GenStatus): Promise<void> {
    await this.prisma.generation.update({ where: { id: generationId }, data: { status } });
    await this.publish(generationId, { status });
  }

  private async publish(generationId: string, event: GenerationEvent): Promise<void> {
    await this.redis
      .publish(genChannel(generationId), JSON.stringify(event))
      .catch((e: unknown) =>
        this.logger.warn(
          `Не удалось опубликовать событие генерации ${generationId}: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
  }

  private parseToneOfVoice(json: Prisma.JsonValue): ToneOfVoice {
    return ToneOfVoiceSchema.parse(json);
  }

  private getPromptsDir(): string {
    if (!this.promptsDir) {
      this.promptsDir = resolvePromptsDir(this.config.get('PROMPTS_DIR', { infer: true }));
    }
    return this.promptsDir;
  }

  /** Понятный пользователю текст ошибки — хранится в Generation.error и уходит в SSE. */
  private toUserError(e: unknown): string {
    if (e instanceof LlmTimeoutError) {
      return 'Сервис AI не ответил вовремя. Попробуйте повторить генерацию.';
    }
    if (e instanceof LlmNetworkError) {
      return 'Не удалось связаться с сервисом AI. Попробуйте повторить генерацию.';
    }
    if (e instanceof LlmInvalidOutputError) {
      return 'AI вернул некорректный результат. Попробуйте повторить генерацию.';
    }
    return 'Внутренняя ошибка генерации. Попробуйте повторить генерацию.';
  }
}
