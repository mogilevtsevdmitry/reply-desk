# DEPLOY — Dokploy / Traefik (целевая среда заказчика)

Образы собираются CI и публикуются в GHCR (`.github/workflows/ci.yaml`, push в main):

| Образ | Назначение | Тэги |
|---|---|---|
| `ghcr.io/<owner>/<repo>/api` | NestJS API (`node dist/main.js`) | `latest`, `sha-<commit>` |
| `ghcr.io/<owner>/<repo>/worker` | BullMQ-воркер (`node dist/worker.js`, ADR-020) | `latest`, `sha-<commit>` |
| `ghcr.io/<owner>/<repo>/web` | Next.js standalone | `latest`, `sha-<commit>` |
| `ghcr.io/<owner>/<repo>/migrate` | одноразовый `prisma migrate deploy` (+seed) — ADR-028 | `latest`, `sha-<commit>` |

Рекомендация: в проде пинить `sha-<commit>`, не `latest` — откат тогда = смена тэга.

---

## ⚠️ NEXT_PUBLIC_API_URL — build-arg, а не runtime-переменная (BUG-003)

`NEXT_PUBLIC_API_URL` **бакируется в JS-бандл на этапе `next build`**. Задать его
переменной окружения работающему контейнеру web **нельзя** — значение уже зашито.

Следствия:

1. Образ web из GHCR пригоден только для того домена API, с которым был собран.
   В GitHub-репозитории нужно задать **Actions variable** `NEXT_PUBLIC_API_URL`
   (Settings → Secrets and variables → Actions → Variables), например
   `https://replydesk.example.com/api/v1` — CI подставит её как build-arg.
   Без переменной CI собирает с дефолтом `http://localhost:4200/api/v1`
   (годится только для локального смоука).
2. **При смене домена API образ web обязательно пересобирается**: обновить
   variable → перезапустить workflow (push в main или re-run) → задеплоить новый тэг.
3. Альтернатива: собирать web прямо в Dokploy из `docker/web.Dockerfile`
   (Build Type: Dockerfile, Build Arg `NEXT_PUBLIC_API_URL=...`) — тогда GHCR-образ web не нужен.

Если api публикуется на том же домене под префиксом `/api` (рекомендованная схема
ниже), то `NEXT_PUBLIC_API_URL=https://<домен>/api/v1` — и CSP `connect-src 'self'`
покрывает запросы автоматически (ADR-029).

---

## Сервисы в Dokploy

Все сервисы — в одном Dokploy-проекте `replydesk`, тип **Docker (image из GHCR)**.
Если пакеты GHCR приватные — добавить Registry credentials (GitHub PAT с `read:packages`).

БД: либо Dokploy-сервисы Postgres 16 / Redis 7 (проще), либо managed. Ниже
предполагаются Dokploy-сервисы `replydesk-pg` (postgres:16-alpine, volume!) и
`replydesk-redis` (redis:7-alpine) в той же docker-сети.

### Переменные окружения по сервисам

Общие для api / worker / migrate:

```env
NODE_ENV=production            # ОБЯЗАТЕЛЬНО: иначе refresh-кука уйдёт без Secure (INFO-001)
DATABASE_URL=postgresql://replydesk:<пароль>@replydesk-pg:5432/replydesk?schema=public
REDIS_URL=redis://replydesk-redis:6379
```

api (+ те же секреты у worker, он использует JWT-схему env при старте):

```env
PORT=4000
JWT_ACCESS_SECRET=<openssl rand -hex 32>
JWT_ACCESS_TTL=15m
REFRESH_TTL_DAYS=30
CORS_ORIGINS=https://<домен-web>
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=<ключ>
ANTHROPIC_MODEL=claude-sonnet-4-5
WORKER_EMBEDDED=false          # воркер — отдельный сервис (ADR-020)
LIMIT_FREE=10
LIMIT_START=100
LIMIT_BUSINESS=1000
SIMILARITY_THRESHOLD=0.3
# PROMPTS_DIR=/app/prompts     # уже задан в образе
```

worker — те же переменные, что api (кроме PORT); `WORKER_EMBEDDED` игнорируется
(entrypoint `dist/worker.js` запускает воркер явно).

migrate: только `DATABASE_URL` (+ `SEED_ON_START=true` один раз, если нужны demo-данные).

web: рантайм-переменных нет (`PORT=3000` в образе; API URL зашит при сборке — см. выше).

Ресурсы (ориентир из compose): api 512M, worker 1G, web 256M.

### Traefik labels

web (роутер на корень домена, TLS letsencrypt):

```
traefik.enable=true
traefik.http.routers.replydesk-web.rule=Host(`replydesk.example.com`)
traefik.http.routers.replydesk-web.entrypoints=websecure
traefik.http.routers.replydesk-web.tls.certresolver=letsencrypt
traefik.http.services.replydesk-web.loadbalancer.server.port=3000
```

api (тот же хост, префикс `/api`; приложение уже слушает с глобальным префиксом
`/api/v1` — stripprefix НЕ нужен):

```
traefik.enable=true
traefik.http.routers.replydesk-api.rule=Host(`replydesk.example.com`) && PathPrefix(`/api`)
traefik.http.routers.replydesk-api.entrypoints=websecure
traefik.http.routers.replydesk-api.tls.certresolver=letsencrypt
traefik.http.services.replydesk-api.loadbalancer.server.port=4000
```

Traefik сопоставляет более специфичный rule (`PathPrefix`) с большим приоритетом —
`/api/*` уйдёт на api, остальное на web. worker и migrate наружу не публикуются
(`traefik.enable=false` / без labels).

Замечания:
- TLS терминируется на Traefik; api шлёт HSTS (helmet), `trust proxy` уже включён в main.ts.
- SSE: при желании поднять таймаут — label
  `traefik.http.routers.replydesk-api.middlewares=...` c `respondingTimeouts` на
  entrypoint-уровне (дефолтов обычно достаточно: соединение живёт, пока идут события).

### Health checks в Dokploy

- api: контейнерный HEALTHCHECK уже в образе (`GET /api/v1/health`, проверяет postgres+redis).
- web: HEALTHCHECK в образе (`GET /login`).
- worker: HTTP нет — наблюдение по логам и глубине очереди (RUNBOOK).

---

## Порядок первого запуска

1. Поднять `replydesk-pg` (с volume!) и `replydesk-redis`, дождаться healthy.
2. Запустить **migrate** (образ `…/migrate`, restart policy: none) — выполняет
   `prisma migrate deploy`; при `SEED_ON_START=true` зальёт demo-данные.
   Дождаться кода выхода 0 (логи: `All migrations have been applied`).
   Ручной шаг: в Dokploy нет нативных one-off job — migrate запускается как сервис
   и останавливается вручную после успеха (или через `docker run --rm` на хосте).
3. Запустить **api** и **worker**, дождаться healthy у api.
4. Запустить **web** (собранный с правильным `NEXT_PUBLIC_API_URL`!).
5. Смоук: `curl https://<домен>/api/v1/health` → `{"status":"ok",...}`; открыть
   `https://<домен>/login`, залогиниться demo-учёткой (если был seed), прогнать отзыв.

## Обновление версии

1. CI на push в main опубликовал `sha-<commit>`.
2. Если миграции менялись — запустить migrate нового тэга (ШАГ ДО обновления api/worker).
3. Обновить тэг у api и worker (порядок не важен: SIGTERM → graceful shutdown,
   воркер дорабатывает активные job до 30с).
4. Обновить web (если менялся фронт или URL API).

Откат: вернуть предыдущий `sha-<commit>` на api/worker/web. Откат миграций — см. RUNBOOK
(prisma не делает down-миграций автоматически — откат кода без отката схемы безопасен,
если миграция была аддитивной).
