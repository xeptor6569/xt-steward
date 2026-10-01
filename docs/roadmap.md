# Roadmap

Milestone one proves the distributed architecture end to end: enrollment,
discovery, dispatch, live streaming, cancellation, and persistence — with a
deliberately boring built-in agent. Everything below is intentionally **not**
in this milestone.

## Next milestones

### Real agent adapters

The `AgentAdapter` interface in `packages/agents` is the seam. Planned
adapters wrap real coding agents (e.g. CLI-based coding assistants) with the
same contract the diagnostic agent satisfies: key-based workspace resolution,
process-group lifecycle, bounded and redacted output, cooperative
cancellation. This includes agent-specific configuration (API keys stored on
the node, never the control plane) and per-agent capability advertisement.

### GitHub integration

- **GitHub OAuth sign-in** — the `users` table already models nullable
  password hashes and a provider seam; `STEWARD_GITHUB_OAUTH_*` env vars are
  parsed but unused so deployments can stage configuration.
- **GitHub App** for repository awareness: linking workspaces to repos,
  branch creation, and pull-request creation from completed runs.

### Run workflow depth

- Task input beyond a free-text string: templates, per-agent parameters.
- Artifacts: diffs, files, and structured results attached to runs.
- Run queueing policies per node (priorities, concurrency classes).
- Scheduled and webhook-triggered runs.

### Multi-user and authorization

Milestone one has admin/member roles with admin-only node management.
Planned: invitations, per-workspace permissions, API tokens for automation,
and audit log surfacing in the dashboard.

### Operations

- Prometheus metrics endpoints and structured trace propagation.
- Node auto-update channel.
- Horizontal API scaling documentation (the Redis pub/sub fan-out already
  supports multiple API replicas behind one load balancer).

## Explicitly out of scope for milestone one

- Executing arbitrary user-supplied commands (the diagnostic agent is fixed).
- Any GitHub/remote-VCS integration (no faked seams beyond parsed env vars).
- Multi-tenancy or organizations.
- Windows support for the node daemon (Linux/macOS first).
- Secrets management for agent credentials (arrives with real adapters).
