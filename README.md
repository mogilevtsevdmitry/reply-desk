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

## Запуск одной командой (docker compose)

```bash
cp .env.example .env   # заполнить ANTHROPIC_API_KEY (в контейнере LLM_PROVIDER=auto
                       # без ключа упадёт — claude CLI там нет; либо LLM_PROVIDER=fake)
docker compose -f docker/compose.yaml --env-file .env up --build -d
```

Web: http://localhost:3200, API: http://localhost:4200/api/v1 (порты настраиваются
в .env, ADR-027). Demo-данные: `SEED_ON_START=true` в .env перед первым запуском.
Dev-режим с hot-reload: добавить `-f docker/compose.dev.yaml`. Деплой — `docs/devops/DEPLOY.md`,
эксплуатация — `docs/devops/RUNBOOK.md`.

## Запуск dev (bare-metal)

Требования: Node.js >= 22, pnpm 10, PostgreSQL 16 и Redis 7.

```bash
# 1. Зависимости
pnpm install

# 2. Окружение
cp .env.example .env   # заполнить JWT_ACCESS_SECRET и DATABASE_URL.
                       # LLM_PROVIDER=auto (дефолт, ADR-034): задан ANTHROPIC_API_KEY →
                       # Anthropic API; ключа нет, но установлен Claude Code CLI →
                       # claude-cli (dev). Явно: LLM_PROVIDER=fake — генерация без сети.

# 3. БД и запуск
pnpm --filter @replydesk/api prisma:migrate   # применяет миграции (+ pg_trgm)
pnpm --filter @replydesk/api db:seed          # demo@replydesk.ru / Demo12345! + 5 отзывов
pnpm dev                                       # turbo: api на :4000, web на :3000
```

Проверка API: `curl http://localhost:4000/api/v1/health`.

## Воркер генерации (BullMQ)

В dev воркер уже работает внутри процесса API (`WORKER_EMBEDDED=true`, дефолт) —
отдельно ничего запускать не нужно. Для прод-топологии (ADR-020) API запускается
с `WORKER_EMBEDDED=false`, а воркер — отдельным процессом из того же образа:

```bash
pnpm --filter @replydesk/api build
pnpm --filter @replydesk/api start:worker   # node dist/worker.js
```

Статусы генерации транслируются через SSE `GET /api/v1/generations/:id/events`
(аутентификация — заголовок Authorization, ADR-004).

## Команды качества

```bash
pnpm typecheck   # tsc --noEmit по всем workspace (contracts собирается первым)
pnpm test        # юнит-тесты (Jest, БД мокается)
pnpm lint        # eslint из packages/config
```

## Статус

Задачи 2.1 (ядро бэкенда) и 2.2 (генерационный конвейер) выполнены: auth
(JWT + ротация refresh), онбординг компании (ADR-005), лимиты-резервирование
(ADR-002), ReviewsModule (создание/история/ретрай), GenerationModule
(BullMQ-воркер + SSE-статусы), LlmModule (AnthropicProvider + FakeLlmProvider,
ADR-019), seed с demo-данными. Дальше (2.4): фронтенд-страницы.
Журнал решений — `docs/DECISIONS.md`.
