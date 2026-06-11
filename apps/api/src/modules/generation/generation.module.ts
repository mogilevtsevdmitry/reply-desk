import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { UsageModule } from '../usage/usage.module';
import { GenerationPipelineService } from './generation-pipeline.service';
import { GenerationQueueService } from './generation-queue.service';
import { GenerationWorkerService } from './generation-worker.service';
import { GenerationController } from './generation.controller';

/**
 * Генерационный конвейер: producer (очередь `generation`), BullMQ-воркер
 * (пайплайн docs/02-DEVELOPER.md раздел 3) и SSE-контроллер статусов (ADR-004).
 */
@Module({
  imports: [LlmModule, UsageModule],
  controllers: [GenerationController],
  providers: [GenerationQueueService, GenerationPipelineService, GenerationWorkerService],
  exports: [GenerationQueueService],
})
export class GenerationModule {}
