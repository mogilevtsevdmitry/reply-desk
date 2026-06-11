# 05 — ТЗ: DevOps

Прочитай 00-OVERVIEW.md и 02-DEVELOPER.md. Задача: контейнеризация, локальный стенд,
CI и подготовка к деплою через Dokploy/Traefik (целевая среда заказчика).

## Dockerfile'ы (docker/)

Три образа, все multi-stage, base `node:22-alpine`, non-root user, pnpm через corepack:

1. `api.Dockerfile` — NestJS: deps (prune для prod) → build → runner.
   Прогон `prisma generate` на этапе build. HEALTHCHECK на GET /api/v1/health.
2. `worker.Dockerfile` — тот же код apps/api, entrypoint процесса воркера BullMQ
   (отдельный процесс от API — независимое масштабирование).
3. `web.Dockerfile` — Next.js standalone output (`output: "standalone"` в next.config),
   копируется только .next/standalone + static.

Используй turbo prune для минимальных контекстов сборки. Итоговые образы: web и api < 300MB.

## docker-compose

`docker/compose.yaml` — полный стенд одного запуска:

- postgres: `postgres:16-alpine` (pg_trgm входит в поставку), volume, healthcheck pg_isready
- redis: `redis:7-alpine`, healthcheck
- migrate: одноразовый сервис `prisma migrate deploy` (+ опционально seed по env-флагу),
  depends_on postgres healthy
- api: depends_on migrate completed + redis healthy
- worker: те же зависимости
- web: depends_on api healthy

`docker/compose.dev.yaml` — оверрайд для разработки: bind-mount исходников, hot-reload,
открытые порты БД. Секреты только через env-файл, в compose значений нет.
Цель: `cp .env.example .env && docker compose up` → рабочее приложение на localhost:3000.

## CI (GitHub Actions, .github/workflows/ci.yaml)

Триггер: PR и push в main. Джобы:

1. **lint-typecheck** — pnpm install (кэш), eslint, tsc --noEmit (turbo)
2. **test** — юнит + интеграционные (Testcontainers; services postgres/redis как fallback)
3. **e2e** — поднять compose, прогнать Playwright, артефакт — трейсы упавших тестов
4. **build-images** — сборка трёх образов с кэшем buildx; на push в main —
   пуш в GHCR с тегами sha и latest
5. **audit** — pnpm audit --prod, fail на critical

## Подготовка к деплою (Dokploy/Traefik)

- `docs/devops/DEPLOY.md`: как завести три сервиса в Dokploy из GHCR-образов,
  labels для Traefik (router web → корень домена, api → /api префикс, TLS letsencrypt),
  переменные окружения по сервисам, порядок первого запуска (migrate → api/worker → web)
- Оркестратор не нужен (без k8s в MVP), но graceful shutdown обязателен — NestJS enableShutdownHooks,
  воркер дорабатывает активные job при SIGTERM (BullMQ close с таймаутом 30с)
- лимиты ресурсов в compose как ориентир: api 512M, worker 1G, web 256M

## Наблюдаемость (минимум MVP)

- /api/v1/health — liveness (ok) и readiness (ping postgres + redis)
- pino → stdout, JSON; docs/devops/RUNBOOK.md: как читать логи, как перезапустить
  застрявшую очередь (bullmq obliterate vs retry), как откатить миграцию,
  как сменить LLM-ключ без даунтайма

## Definition of Done

Чистый клон: `cp .env.example .env`, вписать LLM-ключ, `docker compose up` —
полный happy path работает; CI зелёный на тестовом PR; образы в GHCR; RUNBOOK и DEPLOY написаны.
