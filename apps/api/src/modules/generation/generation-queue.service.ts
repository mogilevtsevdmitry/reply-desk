import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectionOptions, Queue } from 'bullmq';
import type { Env } from '../../config/env';
import type { UsageSource } from '../usage/usage.service';

export const GENERATION_QUEUE_NAME = 'generation';
export const GENERATION_JOB_NAME = 'generate';

/** Опции BullMQ-соединения из REDIS_URL (BullMQ требует maxRetriesPerRequest: null). */
export function bullConnection(redisUrl: string): ConnectionOptions {
  return { url: redisUrl, maxRetriesPerRequest: null };
}

/**
 * Данные job. period и usageSource фиксируются при резервировании —
 * компенсация при FAILED бьёт в тот же период и тот же источник (ADR-037).
 */
export interface GenerationJobData {
  generationId: string;
  reviewId: string;
  companyId: string;
  period: string;
  /** Откуда списана генерация: PLAN (лимит тарифа) | PACKAGE (пакетные кредиты).
   *  Optional — для job, поставленных в очередь до введения биллинга (дефолт PLAN). */
  usageSource?: UsageSource;
}

/** Producer очереди `generation`. Отдельное Redis-соединение (требование BullMQ). */
@Injectable()
export class GenerationQueueService implements OnApplicationShutdown {
  private readonly queue: Queue<GenerationJobData>;

  constructor(config: ConfigService<Env, true>) {
    this.queue = new Queue<GenerationJobData>(GENERATION_QUEUE_NAME, {
      connection: bullConnection(config.get('REDIS_URL', { infer: true })),
    });
  }

  async enqueue(data: GenerationJobData): Promise<void> {
    await this.queue.add(GENERATION_JOB_NAME, data, {
      attempts: 1, // авторетраев нет: FAILED не сохраняется, повтор — новый POST /reviews (ADR-042)
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close().catch(() => undefined);
  }
}
