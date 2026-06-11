# ReplyDesk

AI-сервис реакции на отзывы для локального бизнеса: публичный ответ в трёх тонах,
внутренняя задача, классификация и сообщение для возврата клиента — за ~8 секунд.

Монорепо: pnpm workspaces + Turborepo. Подробности — в `docs/00-OVERVIEW.md`.

```
apps/api        NestJS 11 + Prisma 6 (PostgreSQL 16 + pg_trgm, Redis 7)
apps/web        Next.js 15 (App Router) + Tailwind 4
packages/contracts  zod-схемы DTO, общие для api и web
packages/config     eslint / tsconfig / tailwind-preset
```

## Запуск dev (черновик)

Требования: Node.js >= 22, pnpm 10, PostgreSQL 16 и Redis 7
(docker compose появится на этапе DevOps).

```bash
# 1. Зависимости
pnpm install

# 2. Окружение
cp .env.example .env   # заполнить JWT_ACCESS_SECRET и DATABASE_URL

# 3. БД и запуск
pnpm --filter @replydesk/api prisma:migrate   # применяет миграции (+ pg_trgm)
pnpm dev                                       # turbo: api на :4000, web на :3000
```

Проверка API: `curl http://localhost:4000/api/v1/health`.

## Команды качества

```bash
pnpm typecheck   # tsc --noEmit по всем workspace (contracts собирается первым)
pnpm test        # юнит-тесты (Jest, БД мокается)
pnpm lint        # eslint из packages/config
```

## Статус

Задача 2.1 (ядро бэкенда) выполнена: auth (JWT + ротация refresh), онбординг
компании (ADR-005), лимиты-резервирование (ADR-002), health, схема БД и миграции.
Дальше (2.2): ReviewsModule, GenerationModule (BullMQ + SSE), LlmModule, промпты,
seed, фронтенд-страницы. Журнал решений — `docs/DECISIONS.md`.
