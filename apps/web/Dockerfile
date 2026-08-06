# syntax=docker/dockerfile:1
# Build context: repository root (see compose.yaml).

FROM node:22-alpine AS build
RUN corepack enable pnpm
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
# Empty string = "same origin": the reverse proxy serves the dashboard and
# the API from one hostname, so the browser uses relative URLs.
ARG NEXT_PUBLIC_STEWARD_API_URL=""
ENV NEXT_PUBLIC_STEWARD_API_URL=$NEXT_PUBLIC_STEWARD_API_URL
RUN pnpm --filter @steward/web build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
ENV PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:3000/login" >/dev/null || exit 1
CMD ["node", "apps/web/server.js"]
