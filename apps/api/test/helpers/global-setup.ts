/**
 * Jest globalSetup: поднимает PostgreSQL + Redis в Docker один раз для всего прогона.
 * Контейнеры используют случайные порты — не конфликтуют с dev-серверами.
 */
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';

declare global {
  var __PG_CONTAINER__: StartedPostgreSqlContainer;
  var __REDIS_CONTAINER__: StartedRedisContainer;
}

export default async function globalSetup(): Promise<void> {
  console.log('\n[globalSetup] Поднимаем PostgreSQL + Redis контейнеры...');

  const [pg, redis] = await Promise.all([
    new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('replydesk_test')
      .withUsername('test')
      .withPassword('test')
      .start(),
    new RedisContainer('redis:7-alpine').start(),
  ]);

  global.__PG_CONTAINER__ = pg;
  global.__REDIS_CONTAINER__ = redis;

  const databaseUrl = pg.getConnectionUri();
  const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;

  // Публикуем в env для процессов тестов
  process.env['DATABASE_URL'] = databaseUrl;
  process.env['REDIS_URL'] = redisUrl;
  process.env['_INT_DATABASE_URL'] = databaseUrl;
  process.env['_INT_REDIS_URL'] = redisUrl;

  // Прогоняем миграции prisma в контейнер
  const apiDir = path.resolve(__dirname, '..', '..');
  console.log('[globalSetup] Прогоняем prisma migrate deploy...');
  execSync('npx prisma migrate deploy', {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });

  console.log(`[globalSetup] PostgreSQL: ${databaseUrl}`);
  console.log(`[globalSetup] Redis: ${redisUrl}`);
  console.log('[globalSetup] Контейнеры готовы.\n');
}
