# Node protocol (version 1)

How a steward-node daemon enrolls with the control plane and communicates
over WebSocket. Schemas live in `packages/protocol` and are validated by both
sides on every frame.

## Enrollment

Enrollment exchanges a one-time token for a permanent node credential.

1. An administrator creates an enrollment token in the dashboard. The server
   stores only its SHA-256 hash; the plaintext (`stx_enroll_…`) is shown once.
2. The operator runs on the node machine:

   ```bash
   steward-node enroll --server https://app.stewardxt.cc --token stx_enroll_…
   ```

3. The daemon calls `POST /api/v1/nodes/enroll` with the token, its name, and
   OS metadata. The server **burns the token atomically** (a conditional
   update on `used_at`; expired/revoked/used tokens fail with 401), registers
   the node, and returns a credential (`stx_node_…`) exactly once. Only the
   credential's hash is stored server-side.
4. The daemon writes the credential to its state directory
   (`~/.local/state/steward-node/credentials.json`, mode `0600`).

A name conflict rolls the token burn back so the operator can retry with a
different name without minting a new token. Enrollment refuses plain
`http://` unless `--insecure-http` is passed (local development only).

## Transport

The node opens an outbound WebSocket to `GET /api/v1/node-gateway` with
`Authorization: Bearer <credential>`. Authentication happens before the
upgrade completes; an invalid credential gets a 401 and no socket. Nodes
never listen — all connectivity is node → control plane, so machines behind
NAT work without port forwarding.

Every frame is a JSON envelope:

```json
{
  "protocolVersion": 1,
  "messageId": "msg_…",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "type": "run.event",
  "payload": { … }
}
```

Frames over 256 KiB are rejected before parsing. Invalid frames get a
`server.error` reply; a node that has not sent `node.hello` within the
handshake window is disconnected.

## Messages

Node → server:

| Type             | Purpose                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `node.hello`     | First frame after connect: name, version, OS, capabilities, workspace + agent advertisements, `activeRunIds` for reconciliation |
| `node.heartbeat` | Periodic liveness with current `activeRunIds`                                                                                   |
| `run.accepted`   | Accepts or rejects a dispatch (e.g. unknown workspace key, at capacity)                                                         |
| `run.started`    | The agent process actually started                                                                                              |
| `run.event`      | A log line (`stdout`/`stderr`) or notice, with a node-assigned strictly increasing `sequence`                                   |
| `run.finished`   | Terminal result: `succeeded` \| `failed` \| `cancelled` \| `timed_out`, with exit code / error details                          |

Server → node:

| Type              | Purpose                                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| `server.hello_ok` | Handshake acknowledgement: node ID, server time, heartbeat interval, `runsToCancel` (runs the server considers dead)  |
| `server.error`    | Protocol or authorization error                                                                                       |
| `run.dispatch`    | Execute a run: run ID, type, **workspace key and agent key only** (never paths), optional task, timeout, cancel grace |
| `run.cancel`      | Terminate a run: SIGTERM to the process group, then SIGKILL after `graceMs`                                           |

## Ordering, idempotency, reconciliation

- The gateway processes frames from one node strictly in order.
- `run.event` sequences are de-duplicated server-side, so nodes may safely
  retransmit after reconnecting (the daemon keeps an outbox of unsent frames).
- `run.dispatch` is idempotent on the node: a run ID that is already active
  is re-acknowledged, not restarted. `run.cancel` for an unknown run is
  acknowledged as a no-op.
- After reconnect, `node.hello.activeRunIds` lets the server reconcile:
  server-dead runs are cancelled on the node; node-forgotten runs are marked
  `lost` on the server.
- The workspace advertisement's `localPath` is display-only. The dispatch
  path is key-based: if the key no longer resolves against the node's local
  configuration, the node rejects the run (`run.accepted { accepted: false }`)
  and the server fails it.
