# Deployment

## Control plane (Docker Compose)

The stack: PostgreSQL 17, Redis 7, a one-shot migration container, the API,
the worker, the dashboard, and Caddy as the single public entrypoint. All app
containers run as the non-root `node` user; data lives in named volumes
(`postgres-data`, `redis-data`, `caddy-data`).

### Local evaluation

```bash
cp .env.example .env      # set POSTGRES_PASSWORD
docker compose up -d --build
```

Everything is served on http://localhost — Caddy routes `/api/*` (including
the node WebSocket gateway) to the API and everything else to the dashboard.
Because the dashboard and API share one origin, cookies are first-party and
no CORS is involved.

### Production (TLS)

Point DNS for your control-plane hostname (e.g. `app.stewardxt.cc`) at the
host, open ports 80/443, then in `.env`:

```bash
STEWARD_DOMAIN=app.stewardxt.cc
STEWARD_WEB_ORIGIN=https://app.stewardxt.cc
STEWARD_COOKIE_SECURE=true
```

`docker compose up -d --build` — Caddy provisions and renews the certificate
automatically. With secure cookies enabled the session cookie uses the
`__Host-` prefix, so it is never shared with sibling hosts (keep marketing
pages on the apex or another subdomain).

### Environment reference

| Variable                | Default            | Purpose                                         |
| ----------------------- | ------------------ | ----------------------------------------------- |
| `POSTGRES_PASSWORD`     | — (required)       | Password for the `steward` database user        |
| `STEWARD_DOMAIN`        | empty              | Public hostname; empty serves plain HTTP on :80 |
| `STEWARD_WEB_ORIGIN`    | `http://localhost` | Exact browser origin of the dashboard           |
| `STEWARD_COOKIE_SECURE` | `false`            | `true` when serving over HTTPS                  |
| `STEWARD_LOG_LEVEL`     | `info`             | Backend log level                               |

Health probes: `GET /api/v1/health/live` (liveness) and
`GET /api/v1/health/ready` (checks PostgreSQL and Redis).

### Continuous deployment (GitHub Actions, no SSH)

The repo ships two workflows:

- **CI** (`.github/workflows/ci.yml`) — lint, typecheck, unit, build,
  integration, and Playwright E2E on every push/PR, using GitHub-hosted
  runners with PostgreSQL/Redis service containers.
- **Deploy** (`.github/workflows/deploy.yml`) — runs on a **self-hosted
  runner installed on the production host**. After CI succeeds on `main` (or
  on manual dispatch) it checks out that exact commit locally and runs
  `docker compose up -d --build`, then gates on the API readiness probe.
  Nothing SSHes anywhere; the runner *is* the deploy agent.

All configuration comes from GitHub — no `.env` file is written to the
server. Create a GitHub **environment named `production`** with:

| Kind     | Name                    | Example                    |
| -------- | ----------------------- | -------------------------- |
| Secret   | `POSTGRES_PASSWORD`     | long random string (required) |
| Variable | `STEWARD_DOMAIN`        | `app.stewardxt.cc`         |
| Variable | `STEWARD_WEB_ORIGIN`    | `https://app.stewardxt.cc` |
| Variable | `STEWARD_COOKIE_SECURE` | `true`                     |
| Variable | `STEWARD_LOG_LEVEL`     | `info`                     |

Unset variables fall back to the compose defaults (plain-HTTP localhost
evaluation mode). Changing `POSTGRES_PASSWORD` after the first deploy does
not change the password of the existing database volume — update it in
PostgreSQL first or recreate the volume.

Runner setup on the production host:

1. Install Docker (with the compose plugin) and git.
2. Add a self-hosted runner (repo **Settings → Actions → Runners**) and give
   it the extra label **`prod`** — the deploy job targets
   `[self-hosted, prod]`, so other self-hosted runners won't pick it up.
3. Add the runner's user to the `docker` group and run the runner as a
   service (`./svc.sh install && ./svc.sh start`).

Database/Redis state lives in named Docker volumes under the compose project
name `steward-xt`, so it survives redeploys and is independent of the
runner's checkout directory. Optionally add required reviewers to the
`production` environment for manual deploy approval.

### Upgrades and backups

Migrations are applied by the one-shot `migrate` service before the API and
worker start, so `git pull && docker compose up -d --build` is the whole
upgrade. Back up the `postgres-data` volume (e.g. `docker compose exec
postgres pg_dump -U steward steward > backup.sql`); Redis holds only
transient state and can be rebuilt.

## Steward node (your machines)

Nodes are **not** containers in this stack — they run directly on the
machines whose code agents should work on, and connect outbound (no inbound
ports, NAT-friendly).

Requirements: Node.js 22+, git (for repository metadata).

```bash
git clone <this repo> && cd xt-steward
pnpm install && pnpm --filter @steward/node build
# dist/cli.js is the self-contained daemon; put it wherever you like
```

1. Create a config file (see `apps/node/examples/config.example.yaml`):

   ```yaml
   serverUrl: "https://app.stewardxt.cc"
   nodeName: "home-server-01"
   workspaces:
     - key: "my-project"
       name: "My Project"
       path: "/home/me/code/my-project"
       readOnly: false
   agents:
     - key: "diagnostic"
       type: "diagnostic"
       name: "Built-in Diagnostic Agent"
       enabled: true
   ```

2. In the dashboard: **Nodes → Create enrollment token**, then:

   ```bash
   steward-node enroll --server https://app.stewardxt.cc --token stx_enroll_…
   steward-node validate-config
   steward-node start
   ```

3. Run it as a service — `apps/node/examples/steward-node.service` is a
   hardened systemd unit (dedicated user, `ProtectSystem=strict`, workspace
   paths allow-listed via `ReadWritePaths`).

`steward-node status` shows enrollment state and control-plane reachability.
The daemon reconnects automatically with exponential backoff and resumes
interrupted run event streams.
