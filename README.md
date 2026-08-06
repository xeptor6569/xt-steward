# Steward XT

A self-hosted control plane for running AI coding agents on machines you own.

Steward XT lets you enroll your own machines ("nodes"), point them at approved
project directories ("workspaces"), and submit agent runs from a web dashboard
— with live log streaming, cancellation, and a full audit trail. Your code
never leaves your hardware: the control plane orchestrates; nodes execute.

This repository contains **milestone one**: a complete distributed vertical
slice proving the architecture end to end with a built-in diagnostic agent.

## What works today

- **First-boot setup** — create the initial administrator, then log in with
  session cookies (CSRF-protected, rate-limited).
- **Node enrollment** — mint a one-time token in the dashboard, run
  `steward-node enroll` on your machine, and the node connects outbound over
  an authenticated WebSocket. No inbound ports on your machines.
- **Workspace discovery** — nodes advertise operator-approved directories
  (validated for canonical paths, symlink escapes, and existence). The control
  plane only ever references workspaces by opaque keys — never by path.
- **Diagnostic runs** — submit a run against any workspace on an online node.
  The built-in diagnostic agent collects read-only node/workspace/git
  information; it never executes arbitrary commands.
- **Live streaming** — run output streams to the browser over Server-Sent
  Events with resume support; state transitions are enforced by an explicit
  run state machine and persisted with a gap-free event sequence.
- **Cancellation & liveness** — cancel queued or running runs idempotently;
  heartbeats, presence tracking, and a background reaper handle nodes that
  disappear mid-run.

See [docs/roadmap.md](docs/roadmap.md) for what is deliberately out of scope
in this milestone.

## Quickstart (Docker Compose)

Requires Docker with the compose plugin.

```bash
cp .env.example .env    # set POSTGRES_PASSWORD at minimum
docker compose up -d --build
```

Open http://localhost, create the administrator, then enroll a node from any
machine with Node.js 22+ (see [docs/deployment.md](docs/deployment.md) for
the node install and production/TLS setup).

## Local development

Requires Node.js 22+, pnpm 10, PostgreSQL, and Redis.

```bash
pnpm install
pnpm db:migrate                       # STEWARD_DATABASE_URL must be set
pnpm dev                              # api :3001, web :3000, worker
pnpm node:sim -- --token stx_enroll…  # simulated node for development
```

| Command                        | What it does                                            |
| ------------------------------ | ------------------------------------------------------- |
| `pnpm lint` / `pnpm typecheck` | ESLint + Prettier / strict TypeScript                   |
| `pnpm test`                    | Unit tests (Vitest)                                     |
| `pnpm test:integration`        | Full-stack API tests (Testcontainers or local services) |
| `pnpm test:e2e`                | Playwright browser flow against the real stack          |
| `pnpm build`                   | Builds every app                                        |

The OpenAPI document is served at `/api/docs` on the API.

## Repository layout

```
apps/
  api/        Fastify API + node WebSocket gateway + SSE streaming
  worker/     BullMQ dispatch + background maintenance (reaper, timeouts)
  web/        Next.js dashboard (App Router, Tailwind, TanStack Query)
  node/       steward-node daemon + CLI (runs on your machines)
packages/
  shared/     ids, secret hashing, redaction, run state machine, logging
  protocol/   node <-> control-plane WebSocket protocol (Zod schemas)
  database/   Drizzle ORM schema, client, SQL migrations
  agents/     agent adapter interface + built-in diagnostic agent
  ui/         shared shadcn-style React components
  config/     shared TypeScript / ESLint configuration
deploy/       Caddy reverse-proxy configuration
docs/         architecture, node protocol, security, deployment, roadmap
```

## Documentation

- [Architecture](docs/architecture.md) — components, data flow, run state machine
- [Node protocol](docs/node-protocol.md) — enrollment and WebSocket protocol v1
- [Security model](docs/security.md) — authentication, workspace boundaries, secrets
- [Deployment](docs/deployment.md) — Docker Compose, TLS, node installation
- [Roadmap](docs/roadmap.md) — what comes after milestone one

## License

Apache-2.0
