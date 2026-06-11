import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { GenerationWorkerService } from './modules/generation/generation-worker.service';

/**
 * Отдельный entrypoint BullMQ-воркера для прод-образа (ADR-020):
 * поднимает application context без HTTP и явно запускает воркер
 * (независимо от WORKER_EMBEDDED — API-процесс в проде ставит его в false).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.get(GenerationWorkerService).start();
}

void bootstrap();
