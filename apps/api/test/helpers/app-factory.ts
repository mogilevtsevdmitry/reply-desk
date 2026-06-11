/**
 * Фабрика тестового NestJS-приложения.
 * Поднимает полный AppModule с cookie-parser, глобальным prefix.
 *
 * Rate limit отключён заменой ThrottlerStorage на заглушку, которая всегда
 * сообщает об отсутствии записей — guard пропускает все запросы.
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module';

/** Заглушка throttler-storage: записей нет → rate limit никогда не срабатывает. */
class NoopThrottlerStorage implements ThrottlerStorage {
  storage: Record<string, number[]> = {};

  async increment(
    _key: string,
    _ttl: number,
    _limit: number,
    _blockDuration: number,
    _throttlerName: string,
  ): Promise<{ totalHits: number; timeToExpire: number; isBlocked: boolean; timeToBlockExpire: number }> {
    return { totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 };
  }
}

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(ThrottlerStorage)
    .useClass(NoopThrottlerStorage)
    .compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  await app.init();

  return app;
}
