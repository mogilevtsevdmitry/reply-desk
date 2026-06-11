import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';
import type { Env } from '../../config/env';
import { GenerationPipelineService } from './generation-pipeline.service';
import {
  bullConnection,
  GENERATION_QUEUE_NAME,
  GenerationJobData,
} from './generation-queue.service';

/** Параллелизм воркера (ТЗ: concurrency 5). */
const WORKER_CONCURRENCY = 5;

/**
 * BullMQ-воркер очереди `generation` (ADR-020):
 * - в процессе API стартует на bootstrap, если WORKER_EMBEDDED=true (dev-дефолт);
 * - в прод-образе — отдельный entrypoint src/worker.ts вызывает start() явно.
 */
@Injectable()
export class GenerationWorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(GenerationWorkerService.name);
  private worker: Worker<GenerationJobData> | null = null;

  constructor(
    private readonly pipeline: GenerationPipelineService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get('WORKER_EMBEDDED', { infer: true })) {
      this.start();
    }
  }

  /** Идемпотентный запуск воркера (повторный вызов — no-op). */
  start(): void {
    if (this.worker) return;
    this.worker = new Worker<GenerationJobData>(
      GENERATION_QUEUE_NAME,
      async (job: Job<GenerationJobData>) => this.pipeline.process(job.data),
      {
        connection: bullConnection(this.config.get('REDIS_URL', { infer: true })),
        concurrency: WORKER_CONCURRENCY,
      },
    );
    this.worker.on('error', (e) => this.logger.error(`Ошибка воркера generation: ${e.message}`));
    this.logger.log(`Воркер очереди "${GENERATION_QUEUE_NAME}" запущен (concurrency=${WORKER_CONCURRENCY})`);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
  }
}
