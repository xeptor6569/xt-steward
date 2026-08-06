# syntax=docker/dockerfile:1
# Build context: repository root (see compose.yaml).

FROM node:22-alpine AS build
RUN corepack enable pnpm
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @steward/api build
# Pruned production install for just this app (workspace code is bundled).
RUN pnpm --filter @steward/api deploy --prod --legacy /out

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/dist ./dist
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/package.json ./package.json
# SQL migrations for the one-shot `node dist/migrate.js` container.
COPY --from=build --chown=node:node /repo/packages/database/drizzle ./drizzle
ENV STEWARD_MIGRATIONS_DIR=/app/drizzle
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${STEWARD_API_PORT:-3001}/api/v1/health/live" || exit 1
CMD ["node", "dist/server.js"]
