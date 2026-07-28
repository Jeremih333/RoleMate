# syntax=docker/dockerfile:1.7
FROM node:22.17.0-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /workspace

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/bot-api/package.json apps/bot-api/package.json
COPY apps/miniapp/package.json apps/miniapp/package.json
COPY apps/d1-worker/package.json apps/d1-worker/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/database-contracts/package.json packages/database-contracts/package.json
COPY packages/testing/package.json packages/testing/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN pnpm assets:generate && pnpm build

FROM base AS production-dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/bot-api/package.json apps/bot-api/package.json
COPY apps/miniapp/package.json apps/miniapp/package.json
COPY apps/d1-worker/package.json apps/d1-worker/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/database-contracts/package.json packages/database-contracts/package.json
COPY packages/testing/package.json packages/testing/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile

FROM node:22.17.0-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
RUN addgroup --system --gid 1001 rolemate \
    && adduser --system --uid 1001 --ingroup rolemate rolemate
COPY --from=production-dependencies --chown=rolemate:rolemate /workspace/node_modules ./node_modules
COPY --from=production-dependencies --chown=rolemate:rolemate /workspace/apps/bot-api/node_modules ./apps/bot-api/node_modules
COPY --from=production-dependencies --chown=rolemate:rolemate /workspace/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=production-dependencies --chown=rolemate:rolemate /workspace/packages/database-contracts/node_modules ./packages/database-contracts/node_modules
COPY --from=build --chown=rolemate:rolemate /workspace/apps/bot-api/dist ./apps/bot-api/dist
COPY --from=build --chown=rolemate:rolemate /workspace/apps/bot-api/package.json ./apps/bot-api/package.json
COPY --from=build --chown=rolemate:rolemate /workspace/apps/miniapp/dist ./apps/miniapp/dist
COPY --from=build --chown=rolemate:rolemate /workspace/assets/generated/telegram-bot-avatar.jpg ./assets/generated/telegram-bot-avatar.jpg
COPY --from=build --chown=rolemate:rolemate /workspace/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=rolemate:rolemate /workspace/packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=rolemate:rolemate /workspace/packages/database-contracts/dist ./packages/database-contracts/dist
COPY --from=build --chown=rolemate:rolemate /workspace/packages/database-contracts/package.json ./packages/database-contracts/package.json
USER rolemate
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --quiet --spider http://127.0.0.1:${PORT}/health/live || exit 1
CMD ["node", "apps/bot-api/dist/main.js"]
