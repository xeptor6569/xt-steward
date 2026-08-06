# syntax=docker/dockerfile:1
# Build context: repository root (see compose.yaml).

FROM node:22-alpine AS build
RUN corepack enable pnpm
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @steward/worker build
RUN pnpm --filter @steward/worker deploy --prod --legacy /out

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/dist ./dist
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/package.json ./package.json
USER node
CMD ["node", "dist/server.js"]
