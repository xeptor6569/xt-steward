# Architecture

Steward XT is a control plane / node system. The control plane (API, worker,
web dashboard, PostgreSQL, Redis) runs wherever you host it; **nodes** run on
the machines whose code you want agents to work on and connect outbound only.

```
   Browser ──HTTP/SSE──▶ Caddy ──▶ Next.js web (dashboard)
                            │
                            └────▶ Fastify API ◀──WebSocket── steward-node daemon(s)
                                     │    ▲                        │
                                     │    │ Redis pub/sub          │ spawns agents in
                              PostgreSQL  │                        │ approved workspaces
                                     │    │
                                     └── BullMQ worker (dispatch, reaper, timeouts)
```

## Components

| Component   | Package             | Responsibility                                                                                              |
| ----------- | ------------------- | ----------------------------------------------------------------------------------------------------------- |
| API         | `apps/api`          | REST API (OpenAPI at `/api/docs`), session auth, node WebSocket gateway, SSE log streaming                  |
| Worker      | `apps/worker`       | BullMQ run dispatch with retries, node-offline failure, lost-run reaper, run timeout sweep, session cleanup |
| Web         | `apps/web`          | Next.js dashboard; talks to the API with cookies + CSRF; live logs via `EventSource`                        |
| Node daemon | `apps/node`         | Enrolls, connects outbound, validates workspaces, executes agent runs, streams events                       |
| PostgreSQL  | `packages/database` | Source of truth: users, sessions, nodes, workspaces, agents, runs, run events, audit events                 |
| Redis       | —                   | BullMQ queues, node presence keys (TTL), pub/sub fan-out, rate-limit counters                               |

## Internal messaging

Two Redis pub/sub channel families connect the processes:

- **`steward:node:<nodeId>:commands`** — the worker (or the API's cancel
  endpoint) publishes `dispatch` / `cancel` commands. Whichever API process
  holds that node's WebSocket delivers them. This decouples "which process
  decided" from "which process owns the socket".
- **`steward:run:<runId>:events`** — every persisted run event is published
  after its database insert, carrying the server-assigned sequence. API
  processes fan these out to any subscribed SSE streams.

Run dispatch itself goes through a BullMQ queue (`run-dispatch`) with the run
ID as the job ID, exponential-backoff retries while the node is offline, and a
terminal `failed (node_offline)` transition when retries are exhausted.

## Run state machine

States: `queued → dispatching → running → succeeded | failed | cancelled |
timed_out | lost`, with `cancellation_requested` reachable from `dispatching`
and `running`. Terminal states are absorbing.

Transitions are enforced in one place (`transitionRun` in
`packages/database`): a conditional `UPDATE … WHERE status IN (allowed)` so
racing writers (API, worker, gateway) can never double-apply a transition —
the loser's update matches zero rows. Every transition also inserts a `state`
run event inside the same transaction and publishes it.

## Run event ordering

Nodes assign a strictly increasing per-run sequence to their own events; the
server re-sequences on insert (per-run monotonic counter held in the runs
row) and de-duplicates node retransmissions by `(runId, nodeSequence)`. The
gateway serializes message handling per connection, so events persist in
arrival order. SSE clients resume with `Last-Event-ID`; the stream replays
persisted events past that sequence, then switches to live fan-out, ending
with a `stream.end` event once the run is terminal.

## Liveness

- Nodes heartbeat every `heartbeatIntervalMs` (server-announced). The gateway
  refreshes a Redis presence key with a TTL and updates
  `nodes.last_heartbeat_at`.
- On disconnect, the gateway marks the node offline immediately.
- The worker's maintenance job (every `STEWARD_MAINTENANCE_INTERVAL_MS`):
  marks stale-heartbeat nodes offline, re-publishes dispatches stuck in
  `dispatching`, marks runs `lost` when their node has been gone past
  `STEWARD_RUN_LOST_TIMEOUT_MS`, applies a server-side run-timeout backstop,
  re-sends unanswered cancellations, and prunes expired sessions.
- On reconnect, the node reports `activeRunIds`; the server reconciles —
  runs it already considers dead are cancelled on the node via
  `server.hello_ok.runsToCancel`, and runs the node no longer knows about are
  marked `lost`.

## Monorepo dependency rules

`shared` and `protocol` are dependency-free of any server framework so they
can be consumed by the node daemon and (types only) the browser. `database`
is server-only. `agents` is used by the node daemon only. The web app
mirrors DTO types rather than importing server code.
