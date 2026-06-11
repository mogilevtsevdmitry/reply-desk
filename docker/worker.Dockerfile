# syntax=docker/dockerfile:1
# ============================================================================
# ReplyDesk Worker (BullMQ, ADR-020) — тот же код apps/api, entrypoint dist/worker.js.
# Отдельный процесс от API — независимое масштабирование (05-DEVOPS).
# Stages идентичны api.Dockerfile (общий buildx-кэш слоёв), отличается только CMD.
# Контекст сборки — корень монорепо: docker build -f docker/worker.Dockerfile .
# ============================================================================

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1 \
    TURBO_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2 prune @replydesk/api --docker

FROM base AS build
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN pnpm --filter @replydesk/api exec prisma generate \
    && pnpm turbo run build --filter=@replydesk/api
RUN pnpm --filter @replydesk/api deploy --prod --legacy /prod/api \
    && pnpm --filter @replydesk/api exec prisma generate --schema /prod/api/prisma/schema.prisma
# Диета прод-поддерева — идентично api.Dockerfile (общий кэш слоёв)
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

FROM base AS runner
ENV NODE_ENV=production \
    PROMPTS_DIR=/app/prompts
COPY --from=build --chown=node:node /prod/api /app
COPY --chown=node:node prompts /app/prompts
USER node
# HTTP у воркера нет — здоровье наблюдается по логам и глубине очереди (RUNBOOK.md)
CMD ["node", "dist/worker.js"]
