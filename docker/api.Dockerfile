# syntax=docker/dockerfile:1
# ============================================================================
# ReplyDesk API (NestJS) — multi-stage, node:22-alpine, non-root (05-DEVOPS).
# Контекст сборки — корень монорепо: docker build -f docker/api.Dockerfile .
# Stages: pruner (turbo prune) → build (deps+prisma generate+nest build)
#         → migrate (одноразовый prisma migrate deploy + seed)
#         → runner (прод-образ, default target)
# ============================================================================

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1 \
    TURBO_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

# --- Минимальный контекст workspace через turbo prune -----------------------
FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2 prune @replydesk/api --docker

# --- Полные зависимости + сборка --------------------------------------------
FROM base AS build
# Сначала только манифесты — слой install кэшируется, пока не меняется lockfile
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
# prisma generate ДО nest build (типы клиента нужны компилятору) — требование 05-DEVOPS
RUN pnpm --filter @replydesk/api exec prisma generate \
    && pnpm turbo run build --filter=@replydesk/api
# Прод-поддерево без dev-зависимостей (реальные копии workspace-пакетов),
# затем prisma generate в него (musl-engine + клиент внутри /prod/api/node_modules)
RUN pnpm --filter @replydesk/api deploy --prod --legacy /prod/api \
    && pnpm --filter @replydesk/api exec prisma generate --schema /prod/api/prisma/schema.prisma
# Диета прод-поддерева (цель <300MB): prisma CLI пришёл peer-резолюцией @prisma/client
# и в рантайме не нужен (миграции — target migrate); из runtime клиента удаляем
# wasm-base64-движки чужих БД и sourcemaps (используется library-engine .so)
RUN rm -rf /prod/api/node_modules/.pnpm/prisma@* \
           /prod/api/node_modules/.pnpm/@prisma+engines@* \
           /prod/api/node_modules/.pnpm/typescript@* \
           /prod/api/node_modules/.pnpm/effect@* \
           /prod/api/node_modules/.pnpm/fast-check@* \
           /prod/api/node_modules/prisma \
           /prod/api/node_modules/typescript \
           /prod/api/node_modules/.bin/prisma /prod/api/node_modules/.bin/tsc /prod/api/node_modules/.bin/tsserver \
           /prod/api/src /prod/api/test \
    && cd /prod/api/node_modules/.pnpm/@prisma+client@*/node_modules/@prisma/client/runtime \
    && rm -f *wasm-base64* *.map edge*.js edge*.mjs react-native*.js react-native*.mjs

# --- Одноразовый мигратор (compose service migrate; ADR-028) ----------------
# Полный build-стейдж: prisma CLI + tsx + seed.ts. Запуск:
#   prisma migrate deploy [+ tsx prisma/seed.ts при SEED_ON_START=true]
FROM build AS migrate
WORKDIR /app/apps/api
USER node
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && if [ \"$SEED_ON_START\" = \"true\" ]; then pnpm exec tsx prisma/seed.ts; fi"]

# --- Прод-образ API ----------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production \
    PORT=4000 \
    PROMPTS_DIR=/app/prompts \
    WORKER_EMBEDDED=false
COPY --from=build --chown=node:node /prod/api /app
# prompts/ лежит в корне монорепо и не входит в turbo prune — копируем из контекста
COPY --chown=node:node prompts /app/prompts
USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO /dev/null "http://127.0.0.1:${PORT:-4000}/api/v1/health" || exit 1
CMD ["node", "dist/main.js"]
