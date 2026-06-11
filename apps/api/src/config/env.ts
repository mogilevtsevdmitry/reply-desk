import { z } from 'zod';

/**
 * Валидация переменных окружения на старте приложения.
 * Подключается через ConfigModule.forRoot({ validate }).
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),

  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  LIMIT_FREE: z.coerce.number().int().positive().default(10),
  LIMIT_START: z.coerce.number().int().positive().default(100),
  LIMIT_BUSINESS: z.coerce.number().int().positive().default(1000),

  // --- AI-слой и конвейер генерации (задача 2.2) ---
  // fake — детерминированный FakeLlmProvider без сети (dev/QA, ADR-019)
  LLM_PROVIDER: z.enum(['anthropic', 'fake']).default('anthropic'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-5'),
  // Порог pg_trgm-похожести кандидатов (ADR-001)
  SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.3),
  // Запускать ли BullMQ-воркер внутри процесса API (ADR-020):
  // true — дефолт для dev; в проде API ставит false, воркер — отдельный процесс (dist/worker.js)
  WORKER_EMBEDDED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // Путь к папке промптов; по умолчанию prompts/ ищется вверх от cwd/__dirname
  PROMPTS_DIR: z.string().optional(),

  // --- Rate limiting (@nestjs/throttler) ---
  // Глобальный лимит (req/ttl): дефолт 60 req/60s
  THROTTLE_DEFAULT_LIMIT: z.coerce.number().int().positive().default(60),
  THROTTLE_DEFAULT_TTL_MS: z.coerce.number().int().positive().default(60_000),
  // Auth-лимит (/auth/*): дефолт 10 req/60s
  THROTTLE_AUTH_LIMIT: z.coerce.number().int().positive().default(10),
  THROTTLE_AUTH_TTL_MS: z.coerce.number().int().positive().default(60_000),
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = EnvSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`Некорректная конфигурация окружения: ${parsed.error.message}`);
  }
  if (parsed.data.LLM_PROVIDER === 'anthropic' && !parsed.data.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY обязателен при LLM_PROVIDER=anthropic');
  }
  return parsed.data;
}
