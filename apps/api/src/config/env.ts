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
  // auto — дефолт (ADR-034): есть непустой ANTHROPIC_API_KEY → anthropic, иначе claude-cli;
  // fake — детерминированный FakeLlmProvider без сети (dev/QA, ADR-019);
  // claude-cli — локальный Claude Code CLI по подписке, dev-only (ADR-031)
  LLM_PROVIDER: z.enum(['auto', 'anthropic', 'fake', 'claude-cli']).default('auto'),
  // Пустая строка = ключ не задан (в .env часто остаётся `ANTHROPIC_API_KEY=`)
  ANTHROPIC_API_KEY: z
    .string()
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-5'),
  // Модель для LLM_PROVIDER=claude-cli (алиасы CLI: sonnet | opus | haiku)
  CLAUDE_CLI_MODEL: z.string().default('sonnet'),
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

  // --- Биллинг (ЮKassa, ADR-035..038). Суммы — в копейках. ---
  // Без YOOKASSA_SHOP_ID/SECRET_KEY биллинг выключен: /billing/checkout отдаёт 503
  // BILLING_DISABLED, остальные эндпоинты /billing работают.
  YOOKASSA_SHOP_ID: z
    .string()
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  YOOKASSA_SECRET_KEY: z
    .string()
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  // Bearer-секрет для POST /billing/cron/renewals (автопродление по крону)
  CRON_SECRET: z
    .string()
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  // Базовый URL фронтенда — для return_url после оплаты ЮKassa
  APP_URL: z.string().default('http://localhost:3001'),
  // Цены подписок (копейки): START 100 ген/мес, BUSINESS 1000 ген/мес
  PRICE_START_1M: z.coerce.number().int().positive().default(79_000),
  PRICE_START_3M: z.coerce.number().int().positive().default(219_000),
  PRICE_START_6M: z.coerce.number().int().positive().default(399_000),
  PRICE_START_12M: z.coerce.number().int().positive().default(699_000),
  PRICE_BUSINESS_1M: z.coerce.number().int().positive().default(599_000),
  PRICE_BUSINESS_3M: z.coerce.number().int().positive().default(1_649_000),
  PRICE_BUSINESS_6M: z.coerce.number().int().positive().default(2_999_000),
  PRICE_BUSINESS_12M: z.coerce.number().int().positive().default(5_399_000),
  // Цены разовых пакетов генераций (копейки); пакетные генерации не сгорают
  PRICE_PACK_10: z.coerce.number().int().positive().default(10_000),
  PRICE_PACK_50: z.coerce.number().int().positive().default(50_000),
  PRICE_PACK_100: z.coerce.number().int().positive().default(100_000),

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
