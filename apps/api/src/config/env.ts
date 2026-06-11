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
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = EnvSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`Некорректная конфигурация окружения: ${parsed.error.message}`);
  }
  return parsed.data;
}
