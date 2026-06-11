# syntax=docker/dockerfile:1
# ============================================================================
# ReplyDesk Web (Next.js 15, output: standalone) — multi-stage, non-root.
# Контекст сборки — корень монорепо: docker build -f docker/web.Dockerfile .
#
# ВАЖНО (BUG-003): NEXT_PUBLIC_API_URL бакируется в JS-бандл на этапе `next build`.
# Передавайте его build-arg'ом; при смене публичного URL API образ web нужно
# ПЕРЕСОБРАТЬ — см. docs/devops/DEPLOY.md.
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
RUN pnpm dlx turbo@2 prune @replydesk/web --docker

FROM base AS build
ARG NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN pnpm turbo run build --filter=@replydesk/web

FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# output: standalone (next.config.ts, outputFileTracingRoot = корень монорепо):
# копируется только минимальный сервер + трассированные node_modules + статика
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD wget -qO /dev/null "http://127.0.0.1:${PORT:-3000}/login" || exit 1
CMD ["node", "apps/web/server.js"]
