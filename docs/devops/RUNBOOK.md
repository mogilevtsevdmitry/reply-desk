# RUNBOOK — эксплуатация ReplyDesk

Топология: web (Next.js standalone) · api (NestJS, без embedded-воркера) ·
worker (BullMQ, очередь `generation`, concurrency 5) · postgres:16 · redis:7.
Health: `GET /api/v1/health` → `{ status, checks: { postgres, redis } }` (200/503).

---

## 1. Как читать логи

Все процессы пишут pino-JSON в stdout. Тексты отзывов/имена клиентов **не логируются**
(только id) — это контракт безопасности, при доработках не ломать.

```bash
# compose-стенд (из корня репо)
docker compose -f docker/compose.yaml logs -f api worker
# отдельный контейнер, человекочитаемо (нужен pino-pretty: pnpm dlx pino-pretty)
docker logs -f replydesk-api-1 2>&1 | pnpm dlx pino-pretty
# только ошибки
docker logs replydesk-api-1 2>&1 | grep '"level":50'
```

Полезные поля: `level` (30 info / 40 warn / 50 error), `req.id`, `res.statusCode`,
`generationId`/`reviewId` в логах конвейера. Заголовки `authorization`/`cookie`
редактируются логгером.

Типичные сигналы:
- `Ошибка воркера generation: ...` — проблемы соединения worker↔redis;
- `Graceful-закрытие воркера не уложилось в 30с` — job висел при SIGTERM (job будет
  возвращён в очередь как stalled и подобран после рестарта);
- 503 от `/health` — смотри `checks`: какой из бэкендов down.

## 2. Застрявшая очередь: retry vs obliterate

Симптом: генерации висят в PENDING/ANALYZING, SSE не двигается.

Диагностика (сначала — причина, не симптом):

```bash
# 1) воркер жив?
docker ps --filter name=worker && docker logs --tail 100 replydesk-worker-1
# 2) что в очереди (redis-cli внутри контейнера redis)
docker exec -it replydesk-redis-1 redis-cli
> KEYS bull:generation:*          # обзор
> LLEN bull:generation:wait       # ожидающие
> ZCARD bull:generation:failed    # упавшие (обычно 0 — removeOnFail: true)
> XLEN bull:generation:events     # поток событий
```

**Вариант A — мягкий (по умолчанию): рестарт воркера.**
Active-job, потерянные при падении процесса, BullMQ помечает stalled и
перезапускает автоматически.

```bash
docker compose -f docker/compose.yaml restart worker
```

**Вариант B — retry конкретной генерации.** Ретраев на уровне BullMQ нет намеренно
(`attempts: 1`, ADR-003): пользовательский путь — `POST /api/v1/reviews/:id/retry`
(только для статуса FAILED; заново резервирует лимит). Это предпочтительный способ
«дожать» единичные упавшие генерации.

**Вариант C — жёсткий: obliterate (полная зачистка очереди).** Удаляет ВСЕ job
(wait/active/delayed) безвозвратно. Применять только если очередь забита мусором
(например, после инцидента с битым кодом воркера), и понимая последствие:
зависшие Generation останутся в PENDING навсегда — их нужно перевести в FAILED руками.

```bash
# 1) остановить воркер, чтобы не подбирал job во время зачистки
docker compose -f docker/compose.yaml stop worker
# 2) zачистка (node + bullmq есть в образе воркера)
docker compose -f docker/compose.yaml run --rm --entrypoint node worker -e '
  const { Queue } = require("bullmq");
  const q = new Queue("generation", { connection: { url: process.env.REDIS_URL } });
  q.obliterate({ force: true }).then(() => { console.log("obliterated"); process.exit(0); });'
# 3) перевести осиротевшие генерации в FAILED (psql в контейнере postgres)
docker compose -f docker/compose.yaml exec postgres psql -U replydesk -d replydesk -c \
  "UPDATE \"Generation\" SET status='FAILED', error='OBLITERATED_BY_OPS' \
   WHERE status IN ('PENDING','ANALYZING','GENERATING') AND \"createdAt\" < now() - interval '10 minutes';"
# 4) при необходимости — компенсировать лимиты (used не ниже 0):
#    UPDATE "UsageCounter" SET used = GREATEST(used - <N>, 0) WHERE "companyId"='...' AND period='YYYY-MM';
# 5) запустить воркер
docker compose -f docker/compose.yaml start worker
```

Правило выбора: **сначала A, точечно B; C — крайняя мера с ручной доводкой БД.**

## 3. Откат миграции

Prisma Migrate не генерирует down-миграции. Стратегия:

1. **Сначала откатить код** (предыдущий `sha-`тэг api/worker). Если миграция была
   аддитивной (новая колонка/индекс — наш стандарт), старый код работает поверх
   новой схемы — на этом инцидент обычно исчерпан, схему не трогаем.
2. Если схему откатывать **необходимо** (деструктивная миграция):
   - написать обратный SQL вручную (источник — `apps/api/prisma/migrations/<ts>_<name>/migration.sql`);
   - применить его psql'ом;
   - пометить миграцию откатанной:
     `pnpm exec prisma migrate resolve --rolled-back <имя_миграции>` (из migrate-образа);
   - убедиться: `pnpm exec prisma migrate status`.
3. **Перед любыми деструктивными миграциями** — бэкап:
   `docker compose -f docker/compose.yaml exec postgres pg_dump -U replydesk -Fc replydesk > backup.dump`.
   (Регулярные бэкапы volume'а pgdata — зона владельца стенда; для прода настроить
   cron `pg_dump` или Dokploy backup — вне scope MVP, фиксирую как риск.)

## 4. Смена LLM-ключа без даунтайма

Ключ читается из env при старте процесса; ротация = последовательный перезапуск
с новым `ANTHROPIC_API_KEY`. Без простоя:

1. Выпустить новый ключ в консоли Anthropic (старый ПОКА не отзывать — оба активны).
2. Обновить `ANTHROPIC_API_KEY` в env-настройках сервисов (Dokploy → Environment).
3. Перезапустить **worker** (единственный потребитель ключа в рантайме):
   `docker compose -f docker/compose.yaml up -d worker` / redeploy в Dokploy.
   SIGTERM-остановка graceful: активные job дорабатываются (до 30с), новые job
   ждут в очереди Redis — пользователи видят чуть более долгую «анимацию», но не ошибку.
   API при этом работает непрерывно (приём отзывов/SSE от ключа не зависят).
4. Перезапустить api тем же способом (ключ в env api нужен только для валидации
   конфигурации при `LLM_PROVIDER=anthropic`).
5. Убедиться, что генерации проходят (см. смоук ниже) — затем отозвать старый ключ.

## 5. Смоук после любых работ

```bash
API=http://localhost:4200/api/v1   # или https://<домен>/api/v1
curl -fsS $API/health                                  # {"status":"ok",...}
# полный happy path (нужна учётка): register → login → company → POST /reviews →
# SSE до DONE — см. сценарий в docs/qa/REPORT.md или прогнать Playwright e2e.
```

## 6. Обязательные прод-инварианты (security)

- `NODE_ENV=production` на api — иначе refresh-кука без флага Secure (INFO-001).
- TLS терминируется на Traefik; HSTS уже шлёт api.
- Секреты только в env-настройках Dokploy / `.env` (не в compose, не в git).
- `LLM_PROVIDER=fake` в проде недопустим (детерминированные заглушки вместо AI).
